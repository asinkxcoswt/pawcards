<div align="center">
  <img src="public/pawcards-icon-512.png" width="96" alt="PawCards logo" />
  <h1>PawCards</h1>
  <p><strong>Drawing-first flashcards, on the web.</strong><br/>
  Type the answer, let AI sketch the cue, draw on top, and remember it with spaced repetition.</p>
</div>

---

PawCards is a small, **local-first** flashcard app (PWA) built around a simple
idea: the best cue for recall is often a **picture you drew yourself**. You type
the answer, an image is generated from it, and you scribble over it. Reviews use
spaced repetition, everything lives on your device, and cloud features are
opt-in through a backend **you** own.

It started as a personal tool for taking notes in workshops, and grew a set of
features for learning **together** — sharing decks and reviewing as a group.

## ✨ What you can do

- **Draw-first cards.** The back is the answer (typed text); the front is the
  cue — an AI-generated image and/or your own pen & highlighter ink on top.
- **AI image generation.** Turn a card's answer into an illustration with one
  tap (`✨`). Bring your own image endpoint — a free Cloudflare Worker, a local
  Draw Things / A1111 server, or Gemini/OpenAI.
- **Spaced repetition.** An SM-2-style scheduler with Again / Hard / Good / Easy.
- **100% offline-capable core.** Cards are stored locally (IndexedDB). No account
  required, no server needed to study.
- **Two themes.** *Ink & highlighter* and *Warm paper*, switchable in Settings.
- **Install as an app.** Add to your home screen for a full-screen, native feel.

### Learn together 🤝

- **Share a deck via QR.** A friend scans it and imports your deck (images
  included). Mark individual cards **private** to keep them out of any share.
- **Workshop rooms.** Create a room, invite friends with a QR, and everyone can
  drop their decks in and import each other's.
- **Live group review.** One host drives a shuffled review across the room's
  shared decks; every phone follows along in real time. Grading stays private —
  everyone schedules the cards for themselves.

## 🔒 Local-first & private by design

- Your cards never leave your device unless you turn on sync or sharing.
- Cloud sync and rooms run on **your own** Cloudflare Worker (free tier) — there
  is no central PawCards server. You host your data; friends can run their own.
- Identity is a **Sync ID** (a bearer secret you copy between your devices) — no
  accounts, no tracking.

## 🚀 Try it

```bash
bun install
bun run dev        # http://localhost:5173
```

Study locally right away. To enable AI images, cross-device sync, or rooms,
point the app at a backend (next section).

> Uses [Bun](https://bun.sh). `npm`/`pnpm` work too, but the test runner and the
> worker deploy script assume Bun.

## ☁️ Bring your own backend (optional, free)

The two cloud features — AI image generation and sync/rooms — run on a
**Cloudflare Worker** in your own account, on the free tier. A one-command
script sets it all up (KV storage, the rooms Durable Object, and an access key),
then hands you a QR to scan into the app.

```bash
bunx wrangler login      # once
bun worker/deploy.ts     # provisions + deploys, opens a setup QR
```

Full walkthrough: **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**. Or just ask a
friend who already runs one for their setup QR — no account needed on your side.

## 🧱 Tech

- [Bun](https://bun.sh) · [Vite](https://vitejs.dev) · [React 19](https://react.dev) · TypeScript (strict)
- [Tailwind CSS v4](https://tailwindcss.com) (CSS-first `@theme` tokens, runtime themes)
- [Zustand](https://github.com/pmndrs/zustand) (single store) · [lucide-react](https://lucide.dev) icons
- Backend: a single [Cloudflare Worker](https://developers.cloudflare.com/workers/)
  — Workers AI (image gen), KV (sync + deck shares), and a Durable Object (live rooms)
- Tests: `bun test` (unit) + [Playwright](https://playwright.dev) (end-to-end)

No service worker yet, so the app needs the network to load; your cards
themselves are always local.

## 🗂 Project layout

```
src/
  store.ts            single Zustand store — all mutations live here
  lib/                srs, sync/merge, prompts, sharing, rooms, canvas, pwa…
  components/         Home, DeckView, Editor (drawing), Review, RoomView…
worker/               the Cloudflare Worker + local deploy script
docs/SELF_HOSTING.md  set up your own backend
e2e/  tests/          Playwright specs · Bun unit tests
```

## 🧪 Development

```bash
bun run dev            # dev server
bun run build          # type-check + production build
bun test tests/        # unit tests (SRS, sync merge, prompts, sharing…)
bunx playwright test   # end-to-end
bun run check          # build + unit + e2e
```

## 🎨 A few design choices

- **Answer-first flow** — new cards open with the answer box focused.
- **Easy = retire** — "I know this, never show it again" (rescued via Shuffle-all).
- **Tap-again to confirm** destructive actions, instead of blocking dialogs.
- **Newest-edit-wins sync** — per-card/-deck merge with tombstones for deletes.
- **Negation blindness** — image models draw the nouns you tell them to avoid,
  so the default style avoids text by *genre* rather than by saying "no text".

## 🗺 Status & roadmap

PawCards is a personal project shared in the hope it's useful. Ideas on the list:
a service worker for true offline loading, client-side encryption of synced data,
per-deck styles, and search over answers. Issues and PRs welcome.

## 📄 License

MIT — see [LICENSE](LICENSE). *(If you're reading this before a license file
exists, treat it as “all rights reserved” until one is added.)*

---

<div align="center"><sub>Made with 🐾 for people who learn by drawing.</sub></div>
