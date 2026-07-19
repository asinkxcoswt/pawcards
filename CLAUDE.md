# PawCards

Drawing-first flashcard PWA for Khaan (dev@littlepawcraft.com). Built iteratively
in a long Claude session (July 2026), then ported from a single HTML file
(v2.2.8) to this React/TS project (v3.0.0) with full feature parity.

## What the app is

The card model that emerged from real use: **the Back is the answer (typed
text), the Front is the cue (an AI-generated image and/or the user's own
ink drawn on top of it)**. Review uses spaced repetition. Everything is
local-first with optional cloud sync through the user's own Cloudflare Worker.

Core loop: New card → type the answer (Back, auto-focused) → ✨ generates the
front image from the answer via AI, and/or draw with pen/highlighter → review
due cards with Again/Hard/Good/Easy.

## Stack

- **Bun** (package manager, unit test runner) · **Vite** · **React 19** ·
  **TypeScript strict** · **Tailwind v4** (CSS-first config in `src/index.css`,
  `@theme` tokens) · **Zustand v5** (single store)
- Unit tests: `bun test tests/` (pure logic: SRS, sync merge, settings migration, prompts)
- E2E: `bunx playwright test` (drives the real built app via the `window.__store`
  test hook; `CHROMIUM_PATH` env can point at a preinstalled Chromium)
- `bun run check` = build + unit + e2e

## Layout

```
src/
  store.ts            zustand store: ALL mutations live here (touch/tombstone discipline)
  lib/types.ts        Doc/Card/Deck/Settings/Stroke...
  lib/constants.ts    CARD_W=800 CARD_H=500 logical space, palettes, uuid
  lib/settings.ts     defaults + migrateSettings (see History for why each rule exists)
  lib/db.ts           IndexedDB, whole-Doc single value (db "pawcards"/"doc"/"state")
  lib/srs.ts          SM-2 variant; Easy RETIRES the card (product decision)
  lib/sync.ts         mergeRemote (newest-edit-wins per card + tombstones)
  lib/prompts.ts      describePrompt (SD/Flux) vs instructPrompt (Gemini/OpenAI)
  lib/polish.ts       three providers, txt2img ONLY (img2img was removed — see History)
  lib/canvas.ts       stroke render, bg-image cover draw, Thai-aware canvas text (thumbs only)
  lib/qrconfig.ts     encode/parse the settings-transfer QR payload (AI + sync config)
  lib/share.ts        deck sharing: deck uploads to KV (share-… id, images incl.),
                      QR carries only the pointer {url, id, name, by, count}
  lib/room.ts         workshop rooms: PawRoom Durable Object on the CREATOR's
                      worker (wss://…/room/<code>), one DO per room, pushes full
                      state on every change (useRoom hook, auto-reconnect).
                      Deck payloads stay in KV (share-…); the DO holds pointers
                      (RoomDeckMeta, keyed by deckId so re-share replaces; the
                      DO stamps memberId — only the sharer can re-share/unshare,
                      "remove-deck" msg). Row actions: mine → Re-share/✕,
                      imported → Update/Open, else Import. Unshare leaves the
                      KV payload to its TTL. First connector names the room +
                      becomes host.
  lib/useQrScan.ts    camera decode loop + scanFile (decode a picked image) hook;
                      QrScanner.tsx is the shared UI (video + "🖼 From a photo")
                      used by ALL scanners — settings, deck import, room join
  components/         Home, DeckView, Editor (drawing engine), Review, SettingsModal,
                      DeckModal, CardThumb, ConfirmButton (tap-again pattern), Toast,
                      QrConfigModal (show/scan settings QR; in-app scanner because the
                      iOS PWA can't be deep-linked from the native camera),
                      SyncFab (floating "☁ Sync changes" button when dirty),
                      ShareDeckModal (🤝 in DeckView: nickname → upload → QR),
                      ImportShareModal (🤝 on Home: scan → preview → import;
                      imported decks get deck.sharedBy + 🤝 badge),
                      RoomsSection (Home: room chips + create/join modals),
                      RoomView (members, shared decks, invite QR, share picker),
                      RoomReview (group review: host sends review-flip/next/end
                      via the room socket, everyone follows live; grading is
                      private — any grade except Easy on a non-imported deck
                      imports it implicitly; card content comes from the local
                      store if imported, else lazily-fetched+cached ShareDocs)
worker/               Cloudflare Worker (generation + translation + sync) — source of
                      truth currently deploys from the littlepawcraft repo, copy kept here
e2e/  tests/          Playwright specs / bun unit tests
```

## The Worker (backend, user-owned)

`worker/pawcards-worker.js`, deployed on Khaan's Cloudflare account via the
local provisioning script (the earlier littlepawcraft-repo Workers Builds
pipeline was retired 2026-07 at Khaan's request):

```bash
bunx wrangler login           # once per machine
bun worker/deploy.ts          # main stack (profile "pawcards-polish")
bun worker/deploy.ts paw-test # another stack; scaffolds worker/stacks/paw-test.json
bun worker/deploy.ts NAME --rotate-key  # new SECRET (old QR configs stop working)
```

Each stack has an editable profile `worker/stacks/<profile>.json`
(`{"worker": …, "kv": …}` — kv is a namespace TITLE to find-or-create, or a
32-hex id to bind as-is). The main profile pins kv to Khaan's pre-existing
dashboard namespace titled `"SYNC"`. Gotcha that motivated profiles: wrangler
titles a created namespace after the binding argument (NOT `<worker>-<binding>`),
so titles must be identifier-shaped and collide across stacks without profiles.
Idempotent: reuses the namespace, keeps the SECRET (shown only when first
generated — it can't be read back), writes generated config to
`worker/.wrangler.<worker>.json` (gitignored). `worker/wrangler.toml` is
reference-only documentation. When a run mints a key (new stack or
`--rotate-key`) it also writes + opens `worker/.wrangler.<worker>.qr.svg`
(gitignored — contains the key): a settings card (`worker/settings-qr.ts`,
styled like the in-app QR sheet, shows env + date) that the app imports via
Settings → 📷 Scan settings QR; syncId is blank so devices keep their own.

Endpoints (all CORS `*`; `?key=SECRET` gates everything):
- `POST /` — image generation. Body `{prompt, init_images?, ...}` → `{images:[b64]}`.
  No `init_images` → **txt2img via `@cf/black-forest-labs/flux-1-schnell`** (the
  only path the app uses now). With `init_images` → img2img via SD1.5 (legacy,
  unused). **Thai in the prompt is auto-translated** span-by-span via
  `@cf/meta/m2m100-1.2b` so English style words survive.
- `GET/PUT /sync?key=&id=SYNCID` — whole-doc sync storage in **KV** (binding
  `SYNC`, 24MB guard). Stored value: `{doc, updatedAt}`. KV holds exactly two
  kinds of data: personal sync docs (never expire) and deck-share payloads
  (`share-…`, 60-day `expirationTtl`).
- `WS /room/<code>?key=&member=&name=&room=` — rooms, via the **PawRoom
  Durable Object** (binding `ROOM`, SQLite-backed, free plan, WebSocket
  hibernation). Presence = open sockets; state (meta + deck pointers) in DO
  storage; alarm wipes a room 60d after last activity. Deploy REQUIRES the
  wrangler.toml `[[durable_objects.bindings]]` + `[[migrations]]` blocks
  (copy in `worker/wrangler.toml`) — without them: "ROOM binding missing".

Free-tier notes: Workers AI = 10k neurons/day **per account** (not per worker);
KV = 1k writes/day (sync is user-triggered or on open/hide, never on a timer).
Friends get their own Cloudflare account + worker URL rather than a shared one.

## Sync design

- Identity = **Sync ID** (`paw-xxxx-xxxx-xxxx`), a bearer secret the user copies
  to each device. No accounts (Google-login alternatives were evaluated and
  deliberately rejected — iOS PWA OAuth friction; notes in session).
- Flow: pull → `mergeRemote` → push. Per-card newest-`updated`-wins; deletions
  via `tombstones{id:ts}` (pruned >90d — a device offline >90d can resurrect
  deleted cards). Settings do NOT sync (per-device).
- **Every card mutation must set `updated: now()`** (the `touch` helper in
  store.ts) and **every delete must tombstone** — this discipline is what makes
  sync correct. If you add a mutation, keep it.
- Sync triggers: on app open, on visibilitychange→hidden, and manually —
  Settings → "☁ Sync now" (⏳ loading state) or the floating "☁ Sync changes"
  button (`SyncFab`, home/deck screens only). The 30s-after-edit auto-sync was
  removed at Khaan's request (v3.1): a `dirty` flag in the store (set by
  content mutations, cleared on successful push, recomputed from timestamps vs
  `lastSyncAt` on load) drives the floating button instead.
- Settings save in real time (no Save button since v3.1); emptied
  apiUrl/model/prompt fields restore their defaults on blur. Settings changes
  don't mark the doc dirty (settings never sync).
- **Rooms**: `Doc.rooms` (RoomRef: code/url/memberId) DOES sync — per-code
  newest-wins union in mergeRemote; leaving tombstones the room code. Live
  room state is PUSHED over a WebSocket to the room's Durable Object (v3.2 —
  replaced the KV ?list= polling design Khaan found confusing); create/join
  are pure-local (RoomRef only), the room comes alive when RoomView connects.

## Hard-won lessons (do not re-learn these)

1. **Negation blindness**: SD/Flux-class models DRAW nouns they're told to
   avoid. Never put "no text / no letters" in a positive prompt. The default
   style ("cute flat sticker art, one single centered subject...") avoids
   text by *genre choice* instead. An "abstract mode" checkbox was built on
   this theory and later removed at Khaan's request — quality was worse.
2. **img2img (sketch polishing) was removed** (v1.8). SD1.5 img2img mangled
   drawings. Current model: ✨ = txt2img from the answer; generated image is a
   *background layer*; user ink always composites on top and survives
   regenerate / ✕ image.
3. **iOS canvas `measureText` lies about Thai** — centered canvas text renders
   shifted/overflowing on iPhone only. Review answers are therefore **real DOM
   text** (`Review.tsx` overlay), which uses the browser's native Thai
   word-breaking. Canvas text remains only for deck thumbnails.
4. **Thai font on iOS**: the system font cascade swallows later families —
   `"Sukhumvit Set"` must be FIRST in the font stack (`--font-thai` token).
5. **iOS PWA storage isolation**: Safari and the home-screen app have separate
   IndexedDB containers (I once wrongly said they share). Sync is the bridge.
   Never suggest "Clear History and Website Data" as a cache fix — it deletes
   cards.
6. **HTML caching on iOS**: serve index.html with `Cache-Control: no-cache`
   (vercel.json here). Version string in Settings footer exists so devices can
   be checked (`APP_VERSION` in constants.ts — bump on release). The build
   emits `/version.json` (vite plugin); the app checks it on open + on
   foreground and offers "↻ Update now" (= reload) for MINOR/MAJOR bumps only
   (`lib/version.ts` policy) — so bump the minor version when devices should
   be nudged to update, patch when they shouldn't.
7. **Workers AI docs lie about SDXL**: `stable-diffusion-xl-base-1.0` rejects
   image input (error 3030) despite its documented schema.
8. **Zustand v5**: selectors must return stable references — no `.filter()` in
   a selector (caused React error #185 during the port; see DeckView).
9. **Gemini API free tier has NO image generation** (as of 2026); the app's
   gemini provider requires pay-as-you-go. OpenAI API has no free tier at all.
   That's why the Worker/Flux path is the default recommendation.

## Product decisions

- **Easy = retire** ("I know this — never show again", shows "✓ done").
  Rescue: Shuffle-all (cram) shows retired cards; grading **Again** there
  un-retires. Cram grades otherwise don't touch SRS.
- "Again" during a normal session requeues the card at the end of that session.
- Destructive actions use tap-again-to-confirm (`ConfirmButton`), never
  `window.confirm`.
- New cards open on the **answer box focused** (answer-first flow).
- ✨ with an empty answer: focus the answer box + pulse (`.attn`) + tender toast.
- Icons chosen by Khaan: ⬜ eraser, ⤓ export, 📷 import-as-background.
- Toast must fully hide (fixed once: slide+fade, safe-area aware).

## Deployment

- This repo → its own Vercel project (static Vite build). The old single-file
  version lives at littlepawcraft.com/pawcards.html (Next.js `public/`,
  `output: "export"` — so headers go in **vercel.json**, `headers()` in
  next.config is ignored there).
- **Origin change = fresh IndexedDB.** Migration path for existing data:
  old app → Settings → Export backup → new app Import; or just configure the
  same Sync URL + Sync ID and pull.
- PWA install: Safari → Share → Add to Home Screen (icon: `public/pawcards-icon.png`,
  apple meta tags in index.html). No service worker yet — needs network to load.

## Known gaps / roadmap candidates

- No service worker → no offline page load (cards themselves are local).
- Deck thumbnails still use canvas Thai text (cosmetic misrender possible on iOS).
- Client-side encryption of the sync doc (WebCrypto) — discussed, not built;
  would make the Worker owner a blind host.
- Search over backText; answer box auto-grow; per-deck style prompts.
- KV doc size: guard at 24MB; heavy generated-image use could approach it
  (images are stored as data URLs inside the doc).

## Commands

```bash
bun install
bun run dev        # dev server
bun run build      # tsc + vite build → dist/
bun test tests/    # unit
bunx playwright test    # e2e (CHROMIUM_PATH=... to use a system chromium)
bun run check      # all of the above
```
