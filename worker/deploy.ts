#!/usr/bin/env bun
/**
 * PawCards worker provisioning — creates or updates a COMPLETE worker stack
 * on the Cloudflare account you're logged into, driven by a per-stack
 * profile file you can edit:
 *
 *   worker/stacks/<profile>.json
 *   {
 *     "worker": "pawcards-polish",   // worker name (the *.workers.dev subdomain)
 *     "kv": "SYNC"                   // KV namespace TITLE to find-or-create,
 *   }                                //   or a 32-hex namespace id to use as-is
 *
 * Usage:
 *   bunx wrangler login                    (once per machine)
 *   bun worker/deploy.ts                   # profile "pawcards-polish"
 *   bun worker/deploy.ts paw-test          # profile worker/stacks/paw-test.json
 *                                          #   (scaffolded on first use)
 *   bun worker/deploy.ts paw-test --rotate-key
 *
 * Workshop (ephemeral) stacks:
 *   bun worker/deploy.ts my-workshop --ephemeral 30d --room "My Room" --host-name John
 *     → the worker refuses ALL requests after 30 days (EXPIRES var; the
 *       expiry is remembered in the profile, re-run with --ephemeral to renew),
 *       and the output includes a ready-to-share invite link + QR that joins
 *       the minted room. New stacks always mint a key; add --rotate-key on an
 *       existing stack to cut the previous cohort's links dead.
 *   bun worker/deploy.ts my-workshop --destroy
 *     → deletes the worker (and its profile-created KV namespace) on cleanup day.
 *
 * Idempotent — safe to re-run anytime. The SECRET is kept across runs and
 * shown only when first generated.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inviteLink, type InvitePayload } from '../src/lib/invite'
import { newRoomCode } from '../src/lib/room'
import { settingsQrSvg } from './settings-qr'

const workerDir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const rotateKey = args.includes('--rotate-key')
const destroy = args.includes('--destroy')
const VALUE_FLAGS = ['--ephemeral', '--room', '--host-name']
const profileName =
  args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1] ?? '')) ?? 'pawcards-polish'

/** value of a `--flag value` pair, or undefined */
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

const ephemeralArg = flagValue('--ephemeral')
const roomName = flagValue('--room')
const hostName = flagValue('--host-name')

function parseDuration(s: string): number {
  const m = /^(\d+)([dh])$/.exec(s.trim())
  if (!m) return 0
  return Number(m[1]) * (m[2] === 'd' ? 24 : 1) * 60 * 60 * 1000
}

function fail(msg: string): never {
  console.error('\n✗ ' + msg)
  process.exit(1)
}

function run(cmd: string[], opts: { input?: string; quiet?: boolean } = {}): string {
  if (!opts.quiet) console.log('  $ ' + cmd.join(' '))
  const r = spawnSync(cmd[0], cmd.slice(1), {
    cwd: workerDir,
    input: opts.input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (r.status !== 0) {
    console.error(r.stdout ?? '')
    console.error(r.stderr ?? '')
    fail(`command failed: ${cmd.join(' ')}`)
  }
  // stdout only: bunx/bun writes install noise (e.g. "extracted [2]") to
  // stderr, which corrupts JSON/regex parsing of the combined stream
  return r.stdout ?? ''
}

const wrangler = ['bunx', 'wrangler']

/** parse the JSON array out of wrangler output that may carry log lines containing '[' */
function parseJsonArray<T>(out: string): T[] {
  for (let i = out.indexOf('['); i >= 0; i = out.indexOf('[', i + 1)) {
    try {
      return JSON.parse(out.slice(i)) as T[]
    } catch {
      /* try the next '[' */
    }
  }
  return []
}

/* 0 ─ profile */
interface Profile {
  worker: string
  kv: string
  /** app origin used to build ready-to-share invite links */
  app?: string
  /** ms epoch — set by --ephemeral, kept across re-runs so re-deploys don't silently un-expire a workshop stack */
  expiresAt?: number
}
const DEFAULT_APP = 'https://pawcards.littlepawcraft.com'
if (!/^[a-z0-9][a-z0-9-]{0,52}$/.test(profileName)) {
  fail(`profile name "${profileName}" must be lowercase letters, digits and dashes`)
}
const stacksDir = join(workerDir, 'stacks')
const profilePath = join(stacksDir, profileName + '.json')
let profile: Profile
if (existsSync(profilePath)) {
  try {
    profile = JSON.parse(readFileSync(profilePath, 'utf8')) as Profile
  } catch (e) {
    fail(`could not parse ${profilePath}: ${(e as Error).message}`)
  }
} else {
  // scaffold a new stack profile; KV title must be a valid JS identifier
  // because wrangler titles the namespace after the binding argument
  profile = { worker: profileName, kv: profileName.replace(/-/g, '_') + '_SYNC' }
  mkdirSync(stacksDir, { recursive: true })
  writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')
  console.log(`\n📝 New stack profile scaffolded: worker/stacks/${profileName}.json`)
  console.log('   Edit it to change names, then re-run. Continuing with the defaults…')
}
if (!/^[a-z0-9][a-z0-9-]{0,52}$/.test(profile.worker ?? '')) {
  fail(`profile "worker" ("${profile.worker}") must be lowercase letters, digits and dashes`)
}
if (typeof profile.kv !== 'string' || !profile.kv) {
  fail('profile "kv" must be a KV namespace title (or a 32-hex namespace id)')
}

/* ephemeral expiry: --ephemeral sets it (persisted in the profile); re-runs keep it */
if (ephemeralArg !== undefined) {
  const dur = parseDuration(ephemeralArg)
  if (!dur) fail(`--ephemeral wants a duration like 30d or 12h (got "${ephemeralArg}")`)
  profile.expiresAt = Date.now() + dur
  writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')
}

console.log(`\n🐾 PawCards worker stack "${profileName}" → worker "${profile.worker}", kv "${profile.kv}"`)
if (profile.expiresAt) {
  console.log(`   ⏳ ephemeral — expires ${new Date(profile.expiresAt).toISOString().slice(0, 10)}`)
}

/* 1 ─ auth */
console.log('\n① Checking Cloudflare login…')
const who = spawnSync(wrangler[0], [...wrangler.slice(1), 'whoami'], { cwd: workerDir, encoding: 'utf8' })
if (who.status !== 0 || /not authenticated|login/i.test(who.stdout + who.stderr)) {
  fail('not logged in to Cloudflare. Run once:  bunx wrangler login')
}

/* 1b ─ destroy: delete the worker (+ profile-created KV) and stop */
if (destroy) {
  if (!args.includes(profileName)) fail('--destroy needs the stack name spelled out:  bun worker/deploy.ts <name> --destroy')
  if (profileName === 'pawcards-polish') fail('refusing to destroy the main stack "pawcards-polish"')
  const configPath = join(workerDir, `.wrangler.${profile.worker}.json`)
  if (!existsSync(configPath)) {
    // a config is needed to address the worker; rebuild a minimal one
    writeFileSync(configPath, JSON.stringify({ name: profile.worker, main: 'pawcards-worker.js', compatibility_date: '2026-07-01' }) + '\n')
  }
  console.log(`\n🗑 Destroying stack "${profileName}" (worker "${profile.worker}")…`)
  run([...wrangler, 'delete', '--config', configPath, '--force'])
  console.log('  ✓ worker deleted')
  if (/^[0-9a-f]{32}$/.test(profile.kv)) {
    console.log(`  ↷ keeping KV namespace ${profile.kv} — it was pinned by id in the profile (dashboard-owned, may hold other data)`)
  } else {
    const listOut = run([...wrangler, 'kv', 'namespace', 'list'], { quiet: true })
    const namespaces = parseJsonArray<{ id: string; title: string }>(listOut)
    const ns = namespaces.find((n) => n.title === profile.kv)
    if (ns) {
      run([...wrangler, 'kv', 'namespace', 'delete', '--namespace-id', ns.id])
      console.log(`  ✓ KV namespace "${profile.kv}" deleted (sync docs, shares, images — all gone)`)
    } else {
      console.log(`  ↷ KV namespace "${profile.kv}" not found — nothing to delete`)
    }
  }
  try {
    unlinkSync(configPath)
  } catch {
    /* already gone */
  }
  console.log(`\n✅ Stack destroyed. The profile file worker/stacks/${profileName}.json is kept for your records — delete it if you're done with the name.\n`)
  process.exit(0)
}

/* 2 ─ KV namespace: use id directly, or find-or-create by title */
console.log('\n② KV namespace (sync docs + deck shares)…')
let kvId: string
if (/^[0-9a-f]{32}$/.test(profile.kv)) {
  kvId = profile.kv
  console.log(`  ✓ using namespace id from the profile (${kvId})`)
} else {
  const listOut = run([...wrangler, 'kv', 'namespace', 'list'], { quiet: true })
  const namespaces = parseJsonArray<{ id: string; title: string }>(listOut)
  const existing = namespaces.find((n) => n.title === profile.kv)
  if (existing) {
    kvId = existing.id
    console.log(`  ✓ reusing existing namespace "${profile.kv}" (${kvId})`)
  } else {
    // wrangler titles the namespace after the binding argument, so the title
    // must be identifier-shaped to be creatable from the CLI
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(profile.kv)) {
      fail(
        `namespace titled "${profile.kv}" doesn't exist, and wrangler can only create identifier-style titles (letters/digits/_).\n` +
          `  Either fix "kv" in worker/stacks/${profileName}.json, or create the namespace in the dashboard and put its 32-hex id in "kv".`,
      )
    }
    const created = run([...wrangler, 'kv', 'namespace', 'create', profile.kv])
    const id = /id\s*[:=]\s*"([0-9a-f]{32})"/.exec(created)?.[1]
    if (!id) fail('could not read the new KV namespace id from wrangler output above')
    kvId = id
    console.log(`  ✓ created namespace "${profile.kv}" (${kvId})`)
  }
}

/* 3 ─ generated config + deploy */
console.log('\n③ Deploying the worker (AI + KV + PawRoom Durable Object)…')
const configPath = join(workerDir, `.wrangler.${profile.worker}.json`)
writeFileSync(
  configPath,
  JSON.stringify(
    {
      $schema: 'https://unpkg.com/wrangler/config-schema.json',
      name: profile.worker,
      main: 'pawcards-worker.js',
      compatibility_date: '2026-07-01',
      ai: { binding: 'AI' },
      kv_namespaces: [{ binding: 'SYNC', id: kvId }],
      durable_objects: { bindings: [{ name: 'ROOM', class_name: 'PawRoom' }] },
      migrations: [{ tag: 'v1-rooms', new_sqlite_classes: ['PawRoom'] }],
      ...(profile.expiresAt ? { vars: { EXPIRES: String(profile.expiresAt) } } : {}),
    },
    null,
    2,
  ) + '\n',
)
const deployOut = run([...wrangler, 'deploy', '--config', configPath])
const urlMatch = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(deployOut)
const base = urlMatch?.[0] ?? `https://${profile.worker}.<your-subdomain>.workers.dev`
console.log(`  ✓ deployed ${base}`)

/* 4 ─ SECRET (kept across re-runs; --rotate-key forces a new one) */
console.log('\n④ Access key…')
const secretsOut = run([...wrangler, 'secret', 'list', '--config', configPath], { quiet: true })
const hasSecret = secretsOut.includes('"SECRET"')
let key: string | null = null
if (!hasSecret || rotateKey) {
  key = randomBytes(12).toString('hex')
  run([...wrangler, 'secret', 'put', 'SECRET', '--config', configPath], { input: key, quiet: true })
  console.log(rotateKey ? '  ✓ SECRET rotated' : '  ✓ SECRET generated and set')
} else {
  console.log('  ✓ keeping the existing SECRET (use --rotate-key to replace it)')
}

/* 5 ─ hand-over */
console.log('\n✅ Done! Paste this into PawCards → Settings (endpoint AND sync URL):\n')
if (key) {
  const endpoint = `${base}/?key=${key}`
  console.log(`   ${endpoint}\n`)
  console.log('   ⚠ The key is shown ONLY now — it cannot be read back later.')

  // invite payload: settings via `url`; --room adds a freshly minted room
  const invite: InvitePayload = {
    url: endpoint,
    ...(roomName ? { code: newRoomCode(), name: roomName } : {}),
    ...(hostName ? { by: hostName } : {}),
    ...(profile.expiresAt ? { exp: profile.expiresAt } : {}),
  }

  // a scannable card, styled like the in-app QR sheet; with --room the QR
  // payload is the invite (join room + adopt settings on fresh apps)
  const qrFile = join(workerDir, `.wrangler.${profile.worker}.qr.svg`)
  writeFileSync(
    qrFile,
    await settingsQrSvg({
      endpoint,
      worker: profile.worker,
      host: base.replace(/^https:\/\//, ''),
      note: rotateKey ? 'key rotated' : 'new stack',
      date: new Date().toISOString().slice(0, 10),
      invite: roomName ? invite : undefined,
    }),
  )

  const app = profile.app ?? DEFAULT_APP
  console.log(`\n   🔗 Ready-to-share link (paste into Line — opens the real browser):\n`)
  console.log(`   ${inviteLink(app, invite)}\n`)
  if (roomName) {
    console.log(`   🏫 Room "${roomName}" (${invite.code}) — open the link or scan the QR YOURSELF first:`)
    console.log('      the first person to connect becomes the room host.')
  }
  if (profile.expiresAt) {
    console.log(`   ⏳ Everything above stops working ${new Date(profile.expiresAt).toISOString().slice(0, 10)}.`)
  }
  console.log(`\n   📱 QR card: ${qrFile}`)
  console.log('      (fresh apps: scan = full onboarding · configured apps: joins the room only)')
  if (process.platform === 'darwin') spawnSync('open', [qrFile])
} else {
  console.log(`   ${base}/?key=<your existing key>\n`)
  console.log('   (key unchanged — the one already in your app settings keeps working)')
  if (roomName || ephemeralArg) {
    console.log('   ⚠ No invite link/QR generated: the key cannot be read back for embedding.')
    console.log('     Re-run with --rotate-key to mint a fresh key (old links stop working).')
  }
}
console.log(`\n   Stack profile: worker/stacks/${profileName}.json — edit names there, re-run to apply.\n`)
