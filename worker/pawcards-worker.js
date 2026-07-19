/**
 * PawCards polish endpoint — Cloudflare Worker
 *
 * Turns your rough sketch into a polished image using Workers AI
 * (@cf/runwayml/stable-diffusion-v1-5-img2img). Speaks the same
 * protocol as PawCards' "Local / self-hosted" provider, so in the app
 * you just set the Endpoint URL to this Worker's URL.
 *
 * ── Deploy (no CLI needed) ─────────────────────────────────────────
 * 1. dash.cloudflare.com → Workers & Pages → Create → Worker
 *    (any name, e.g. "pawcards-polish") → Deploy the hello-world.
 * 2. Edit code → replace everything with this file → Deploy.
 * 3. Worker → Settings → Bindings → Add → "Workers AI",
 *    variable name: AI  → Save. (Without this you'll get an error.)
 * 4. Optional but recommended: change SECRET below to any password.
 * 5. In PawCards → Settings → Provider "Local / self-hosted" →
 *    Endpoint URL:  https://<your-worker>.workers.dev/?key=<SECRET>
 * ───────────────────────────────────────────────────────────────────
 */

const SECRET = "";                 // fallback only — prefer setting a SECRET env var/secret
                                   // in the Worker (Settings → Variables) so it's not in git
// NOTE: SDXL-base on Workers AI rejects image input (error 3030) despite its docs —
// only dedicated img2img models work. Options to try in MODEL below:
//   "@cf/runwayml/stable-diffusion-v1-5-img2img"  (proven to work)
//   "@cf/lykon/dreamshaper-8-lcm"                 (SD1.5 fine-tune, often prettier — experimental)
const MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";
const TXT2IMG_MODEL = "@cf/black-forest-labs/flux-1-schnell";  // used when no sketch is sent
const TRANSLATE_MODEL = "@cf/meta/m2m100-1.2b";                // Thai answers → English prompts

async function maybeTranslate(env, text) {
  // Flux/SD only understand English. Translate ONLY the Thai spans, so the
  // English style/instruction words around them pass through untouched.
  if (!/[\u0E00-\u0E7F]/.test(text)) return text;   // Thai Unicode block
  try {
    const parts = text.split(/([\u0E00-\u0E7F][\u0E00-\u0E7F\s]*)/g);
    const out = [];
    for (const part of parts) {
      if (/[\u0E00-\u0E7F]/.test(part)) {
        const r = await env.AI.run(TRANSLATE_MODEL, {
          text: part.trim(), source_lang: "th", target_lang: "en",
        });
        out.push((r && r.translated_text) ? r.translated_text : part);
      } else {
        out.push(part);
      }
    }
    return out.join("");
  } catch (e) {
    return text;   // translation failing shouldn't kill the generation
  }
}
const WIDTH = 768, HEIGHT = 480;   // 8:5 landscape, SD1.5-friendly size
const IS_LCM = MODEL.includes("lcm");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    const url = new URL(request.url);
    const secret = (env && env.SECRET) || SECRET;

    /* ---------- Rooms: WebSocket /room/<code>?key=&member=&name=&room= ---------- */
    // Each room is one Durable Object (id = room code). It holds the live
    // state (who's here, which decks are shared) and pushes every change to
    // all connected phones — no polling. Deck payloads stay in KV (share-…).
    if (url.pathname.startsWith("/room/")) {
      if (secret && url.searchParams.get("key") !== secret) {
        return json(403, { error: "wrong or missing ?key=" });
      }
      if (!env.ROOM) {
        return json(500, { error: "ROOM binding missing — add the PawRoom Durable Object (see wrangler.toml)" });
      }
      const code = url.pathname.slice("/room/".length);
      if (!/^room-[a-z0-9][a-z0-9-]{3,40}$/.test(code)) return json(400, { error: "bad room code" });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }

    /* ---------- Cloud sync: GET/PUT /sync?key=SECRET&id=SYNCID ---------- */
    if (url.pathname === "/sync") {
      if (secret && url.searchParams.get("key") !== secret) {
        return json(403, { error: "wrong or missing ?key=" });
      }
      if (!env.SYNC) {
        return json(500, { error: "SYNC storage missing — create a KV namespace and bind it as SYNC (see wrangler.toml)" });
      }
      const id = (url.searchParams.get("id") || "").trim();
      if (id.length < 8) return json(400, { error: "sync id missing or too short" });
      const kvKey = "doc:" + id;
      if (request.method === "GET") {
        const stored = await env.SYNC.get(kvKey);
        if (!stored) return json(404, { error: "no data yet for this sync id" });
        return new Response(stored, { status: 200, headers: { "Content-Type": "application/json", ...CORS } });
      }
      if (request.method === "PUT" || request.method === "POST") {
        const txt = await request.text();
        if (txt.length > 24 * 1024 * 1024) {
          return json(413, { error: "data too large (24MB max) — try removing generated images from old cards" });
        }
        let body;
        try { body = JSON.parse(txt); } catch { return json(400, { error: "expected JSON body" }); }
        const updatedAt = Date.now();
        // shared decks are temporary — expire them so workshop debris doesn't
        // pile up in KV (personal sync docs never expire)
        const ttl = /^share-/.test(id) ? { expirationTtl: 60 * 60 * 24 * 60 } : undefined;
        await env.SYNC.put(kvKey, JSON.stringify({ doc: body.doc || body, updatedAt }), ttl);
        return json(200, { ok: true, updatedAt });
      }
      return json(405, { error: "use GET or PUT" });
    }

    if (request.method !== "POST") {
      return json(200, { ok: true, hint: "POST a PawCards polish request here" });
    }
    if (secret && url.searchParams.get("key") !== secret) {
      return json(403, { error: "wrong or missing ?key=" });
    }

    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: "expected JSON body" }); }

    const b64 = body.init_images && body.init_images[0];
    let promptText = (body.prompt || "").trim();
    if (!b64 && !promptText) return json(400, { error: "init_images[0] or prompt required" });
    if (!env.AI) return json(500, { error: "AI binding missing — add a Workers AI binding named AI in the Worker's settings" });

    try {
      promptText = await maybeTranslate(env, promptText);
      let result;
      if (b64) {
        // sketch → polished (img2img)
        const strength = Math.min(0.95, Math.max(0.1, +body.denoising_strength || 0.55));
        result = await env.AI.run(MODEL, {
          prompt: promptText || "clean polished illustration",
          negative_prompt: body.negative_prompt || "blurry, messy, low quality",
          image_b64: b64,
          strength,
          num_steps: IS_LCM ? 8 : 20,     // LCM models want few steps
          guidance: IS_LCM ? 1.5 : 7.5,   // ...and low guidance
          width: WIDTH,
          height: HEIGHT,
        });
      } else {
        // words → image (txt2img via Flux; returns {image: base64} JSON, fixed square-ish size)
        result = await env.AI.run(TXT2IMG_MODEL, { prompt: promptText, steps: 6 });
      }
      let out;
      if (result && typeof result === "object" && typeof result.image === "string") {
        out = result.image;                       // Flux-style JSON response
      } else {
        const buf = result instanceof ReadableStream
          ? await new Response(result).arrayBuffer()
          : result;                               // binary PNG response
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        out = btoa(bin);
      }
      return json(200, { images: [out] });
    } catch (e) {
      return json(502, { error: "Workers AI failed: " + (e && e.message || e) });
    }
  },
};

/* ═══════════════ PawRoom — one Durable Object per workshop room ═══════════════
 *
 * Uses the WebSocket Hibernation API (state.acceptWebSocket) so idle rooms
 * cost nothing. Storage keys:
 *   meta   {name, host, createdAt}        set by the first person to connect
 *   decks  RoomDeckMeta[]                 pointers to share-… payloads in KV
 * Members are NOT stored — presence = currently open sockets (attachment
 * carries {memberId, name} and survives hibernation).
 * An alarm wipes the room 60 days after the last activity.
 */
const ROOM_TTL_MS = 60 * 24 * 60 * 60 * 1000;

export class PawRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return json(426, { error: "expected a websocket connection" });
    }
    const url = new URL(request.url);
    const memberId = (url.searchParams.get("member") || "").slice(0, 32) || "anon";
    const name = (url.searchParams.get("name") || "?").slice(0, 24);
    const roomName = (url.searchParams.get("room") || "Room").slice(0, 48);

    // the first person to connect names the room and becomes its host
    let meta = await this.state.storage.get("meta");
    if (!meta) {
      meta = { name: roomName, host: name, createdAt: Date.now() };
      await this.state.storage.put("meta", meta);
    }
    await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);

    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ memberId, name });
    await this.broadcast();
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws, msg) {
    let m;
    try { m = JSON.parse(msg); } catch { return; }
    let a;
    try { a = ws.deserializeAttachment() || {}; } catch { a = {}; }

    if (m.type === "share-deck" && m.meta && typeof m.meta.deckId === "string") {
      const decks = (await this.state.storage.get("decks")) || [];
      // the DO stamps the sharer — clients can't spoof someone else's share
      const meta = { ...m.meta, memberId: a.memberId };
      const i = decks.findIndex((d) => d.deckId === meta.deckId);
      if (i >= 0) {
        // only the original sharer may replace their entry (re-share = update)
        if (decks[i].memberId && decks[i].memberId !== a.memberId) return;
        decks[i] = meta;
      } else {
        decks.push(meta);
      }
      await this.state.storage.put("decks", decks);
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      await this.broadcast();
    }

    if (m.type === "remove-deck" && typeof m.deckId === "string") {
      const decks = (await this.state.storage.get("decks")) || [];
      const entry = decks.find((d) => d.deckId === m.deckId);
      if (!entry) return;
      if (entry.memberId && entry.memberId !== a.memberId) return; // sharer-only
      await this.state.storage.put("decks", decks.filter((d) => d.deckId !== m.deckId));
      await this.state.storage.setAlarm(Date.now() + ROOM_TTL_MS);
      await this.broadcast();
      // the share-… payload in KV is left to its 60-day TTL
    }
  }

  async webSocketClose() { await this.broadcast(); }
  async webSocketError() { await this.broadcast(); }

  async broadcast() {
    const meta = (await this.state.storage.get("meta")) || {};
    const decks = (await this.state.storage.get("decks")) || [];
    const members = [];
    const seen = new Set();
    const sockets = this.state.getWebSockets();
    for (const ws of sockets) {
      let a;
      try { a = ws.deserializeAttachment(); } catch { a = null; }
      if (a && a.memberId && !seen.has(a.memberId)) {
        seen.add(a.memberId);
        members.push({ memberId: a.memberId, name: a.name });
      }
    }
    const state = JSON.stringify({ type: "state", name: meta.name, host: meta.host, createdAt: meta.createdAt, members, decks });
    for (const ws of sockets) {
      try { ws.send(state); } catch { /* closing socket — presence updates on its close event */ }
    }
  }

  async alarm() {
    await this.state.storage.deleteAll();
    for (const ws of this.state.getWebSockets()) {
      try { ws.close(1000, "room expired"); } catch { /* already gone */ }
    }
  }
}
