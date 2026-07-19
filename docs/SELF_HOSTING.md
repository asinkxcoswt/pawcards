# Set up your own PawCards backend

PawCards works fully offline — draw cards, review them, all stored on your
device. But two features need a small **backend**: ✨ AI image generation and
☁️ syncing / 🏫 rooms across devices. That backend is a **Cloudflare Worker**
running in *your own* Cloudflare account, on the free tier.

You have two options:

- **Easiest — get a QR from a friend.** If someone you know already runs a
  PawCards worker, ask them for a *setup QR*. Scan it in the app
  (Settings → 📷 Scan settings QR) and you're done — you'll use their worker.
  No account, no setup. *(You share their free quota, so this is best among
  friends.)*
- **Run your own** (this guide). Takes about 10 minutes, one time. You get your
  own private backend and your own free quota.

---

## What you'll need

- A **Cloudflare account** — free, no credit card. Sign up at
  [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
- **[Bun](https://bun.sh)** installed (the tool that runs the deploy script):
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **git**, to download the source code.

---

## Steps

### 1. Download the source

```bash
git clone git@github.com:asinkxcoswt/pawcards.git pawcards
cd pawcards
bun install
```

### 2. Log in to Cloudflare (once per computer)

```bash
bunx wrangler login
```

This opens your browser and asks you to authorize Wrangler (Cloudflare's own
tool) to manage Workers in **your** account. Approve it and come back to the
terminal.

### 3. Deploy your worker

```bash
bun worker/deploy.ts
```

That single command sets up the whole backend for you:

- creates a **KV namespace** (storage for sync + shared decks),
- uploads the worker with its **AI**, **KV**, and **rooms (Durable Object)**
  bindings,
- generates a secret **access key**,
- prints your endpoint URL, and **opens a setup QR image**
  (`worker/.wrangler.pawcards-polish.qr.svg`).

When it finishes you'll see something like:

```
✅ Done! Paste this into PawCards → Settings (endpoint AND sync URL):

   https://pawcards-polish.<your-subdomain>.workers.dev/?key=abc123…
```

> ⚠️ The access key is shown **only this once** — it can't be read back later.
> Keep the URL somewhere safe.

### 4. Connect the app

Open PawCards → **Settings → 📷 Scan settings QR** and scan the QR image the
script opened (from your screen, or the `.svg` file). That configures the app
in one step — provider, endpoint, and sync URL. Done! ✨☁️🏫

*(Prefer manual? Paste the printed URL into both the **Endpoint URL** and
**Sync server URL** fields in Settings.)*

---

## Sharing with friends

Once your worker is running, you can onboard friends in seconds:

- In the app, **Settings → ▦ Show settings QR → 🤝 Share with friend** produces
  a QR **without your Sync ID** — they scan it, use your worker, but keep their
  own separate cards.
- Or they follow this same guide to run their own.

---

## Good to know

- **It's free.** On Cloudflare's free tier you get ~10,000 AI image
  "neurons"/day per account and 1,000 KV writes/day — plenty for personal use.
  Rooms use Durable Objects, also included free.
- **Update the worker anytime** by re-running `bun worker/deploy.ts` — it keeps
  your key and data.
- **Rotate the key** (e.g. if it leaked): `bun worker/deploy.ts --rotate-key`.
  This prints a new key and QR; old QRs/configs stop working, so re-scan on your
  devices.
- **Multiple backends** (e.g. a test one, or one per friend group): give the
  stack a name, `bun worker/deploy.ts my-other-stack`. Each has its own editable
  profile under `worker/stacks/<name>.json`.
- **Nothing is committed to git.** The generated config, key, and QR live in
  gitignored files on your machine only.

---

## Troubleshooting

- **`not logged in to Cloudflare`** → run `bunx wrangler login` first.
- **A KV namespace name collides** → edit `worker/stacks/pawcards-polish.json`
  and set `"kv"` to a different title, or to an existing namespace's 32-hex id,
  then re-run.
- **Rooms say "worker is older than your app"** → re-run `bun worker/deploy.ts`
  to pick up the latest worker code.
- **Group review / rooms don't work at all** → make sure the deploy included the
  Durable Object (the script does this automatically; if you deploy by hand,
  the `[[durable_objects.bindings]]` + `[[migrations]]` blocks are required).
