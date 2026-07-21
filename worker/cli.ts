#!/usr/bin/env bun
/**
 * PawCards worker CLI — provisions and operates a worker stack on the
 * Cloudflare account you're logged into.
 *
 *   bunx wrangler login                                  (once per machine)
 *
 *   bun worker/cli.ts <profile> deploy [--kv NAME]       create/update the stack
 *   bun worker/cli.ts <profile> rotate-key               new SECRET (old keys + temp keys die)
 *   bun worker/cli.ts <profile> create-room --exp 30d [--name "My Room"] [--host-name John] [--share-server]
 *   bun worker/cli.ts <profile> destroy                  delete worker (+ profile-created KV)
 *
 * create-room mints a ROOM-ONLY key by default (guests join + swap decks, but
 * cannot generate on your server). Add --share-server to mint a full temp key
 * so guests can also use ✨ on your server (spends your account's quota).
 *
 * Profiles live in worker/stacks/<profile>.json ({worker, kv, app?}) — `--kv`
 * is only needed the first time (find-or-create by TITLE, or a 32-hex id to
 * bind as-is); afterwards the profile remembers it.
 *
 * The root SECRET (minted on first deploy / rotate-key) is saved to the
 * gitignored worker/.wrangler.<worker>.secret.json so `create-room` can sign
 * invites offline: room invites carry a STATELESS TEMP KEY
 * (pt_<exp>.<hmac(root)>, see src/lib/tempkey.ts) — the room's whole invite
 * dies at --exp, and rotate-key kills every outstanding temp key at once.
 * No EXPIRES var, no ephemeral stacks: expiry lives in the key itself.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inviteLink, type InvitePayload } from '../src/lib/invite'
import { newRoomCode } from '../src/lib/room'
import { mintRoomKey, mintTempKey } from '../src/lib/tempkey'
import { settingsQrSvg } from './settings-qr'

const workerDir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)

function fail(msg: string): never {
  console.error('\n✗ ' + msg)
  process.exit(1)
}

const USAGE = `usage:
  bun worker/cli.ts <profile> deploy [--kv NAME]
  bun worker/cli.ts <profile> rotate-key
  bun worker/cli.ts <profile> create-room --exp 30d [--name "My Room"] [--host-name John]
  bun worker/cli.ts <profile> destroy`

const [profileName, command] = args
const COMMANDS = ['deploy', 'rotate-key', 'create-room', 'destroy']
if (!profileName || profileName.startsWith('--')) fail('first argument must be the profile name.\n\n' + USAGE)
if (!COMMANDS.includes(command)) fail(`second argument must be one of: ${COMMANDS.join(', ')}\n\n${USAGE}`)

/** value of a `--flag value` pair, or undefined */
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

function parseDuration(s: string): number {
  const m = /^(\d+)([dh])$/.exec(s.trim())
  if (!m) return 0
  return Number(m[1]) * (m[2] === 'd' ? 24 : 1) * 60 * 60 * 1000
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

/* ---------- profile ---------- */
interface Profile {
  worker: string
  kv: string
  /** app origin used to build ready-to-share invite links */
  app?: string
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
  const kvFlag = flagValue('--kv')
  if (kvFlag && kvFlag !== profile.kv) {
    profile.kv = kvFlag
    writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')
    console.log(`\n📝 Profile updated: kv → "${kvFlag}"`)
  }
} else {
  if (command !== 'deploy') fail(`no profile worker/stacks/${profileName}.json yet — run "deploy" first`)
  // KV title must be identifier-shaped because wrangler titles the namespace
  // after the binding argument
  profile = { worker: profileName, kv: flagValue('--kv') ?? profileName.replace(/-/g, '_') + '_SYNC' }
  mkdirSync(stacksDir, { recursive: true })
  writeFileSync(profilePath, JSON.stringify(profile, null, 2) + '\n')
  console.log(`\n📝 New stack profile: worker/stacks/${profileName}.json (${JSON.stringify(profile)})`)
}
if (!/^[a-z0-9][a-z0-9-]{0,52}$/.test(profile.worker ?? '')) {
  fail(`profile "worker" ("${profile.worker}") must be lowercase letters, digits and dashes`)
}
if (typeof profile.kv !== 'string' || !profile.kv) {
  fail('profile "kv" must be a KV namespace title (or a 32-hex namespace id)')
}

const configPath = join(workerDir, `.wrangler.${profile.worker}.json`)
/** gitignored — lets create-room sign temp keys without asking Cloudflare */
const secretPath = join(workerDir, `.wrangler.${profile.worker}.secret.json`)
interface SecretFile {
  url: string // https://…workers.dev (no key)
  key: string // root SECRET
}
const readSecretFile = (): SecretFile | null => {
  try {
    return existsSync(secretPath) ? (JSON.parse(readFileSync(secretPath, 'utf8')) as SecretFile) : null
  } catch {
    return null
  }
}

function checkLogin(): void {
  console.log('\n① Checking Cloudflare login…')
  const who = spawnSync(wrangler[0], [...wrangler.slice(1), 'whoami'], { cwd: workerDir, encoding: 'utf8' })
  if (who.status !== 0 || /not authenticated|login/i.test(who.stdout + who.stderr)) {
    fail('not logged in to Cloudflare. Run once:  bunx wrangler login')
  }
}

/* ---------- shared hand-over: settings QR + invite link ---------- */
async function handOver(
  base: string,
  key: string,
  note: string,
  room?: { code: string; name: string; by?: string; exp: number; shareServer?: boolean },
) {
  // room invite: full temp key only when the host opts to share the server;
  // otherwise a room-only key (guests join + swap decks, no generation/sync)
  const roomKey = room ? (room.shareServer ? await mintTempKey(key, room.exp) : await mintRoomKey(key, room.exp)) : key
  const endpoint = `${base}/?key=${roomKey}`
  const invite: InvitePayload = room
    ? { url: endpoint, code: room.code, name: room.name, ...(room.by ? { by: room.by } : {}), exp: room.exp }
    : { url: endpoint }
  const qrFile = join(workerDir, `.wrangler.${profile.worker}.${room ? room.code + '.' : ''}qr.svg`)
  writeFileSync(
    qrFile,
    await settingsQrSvg({
      endpoint,
      worker: profile.worker,
      host: base.replace(/^https:\/\//, ''),
      note,
      date: new Date().toISOString().slice(0, 10),
      invite: room ? invite : undefined,
    }),
  )
  if (room) {
    const app = profile.app ?? DEFAULT_APP
    console.log(
      `\n   🏫 Room "${room.name}" (${room.code}) — the invite carries a ${room.shareServer ? 'full temp key: guests can GENERATE on this server' : 'room-only key: guests join + swap decks, but CANNOT generate on this server'}.`,
    )
    console.log(`\n   🔗 Ready-to-share link (paste into Line — opens the real browser):\n`)
    console.log(`   ${inviteLink(app, invite)}\n`)
    console.log(`   ⏳ Invite (key + room) stops working ${new Date(room.exp).toISOString().slice(0, 10)}.`)
    if (!room.shareServer) console.log('   ↷ add --share-server to let guests use this server for AI generation.')
    console.log('   ⚠ JOIN YOUR OWN ROOM FIRST — the first person to connect becomes the host.')
  } else {
    console.log(`\n   ${endpoint}\n`)
    console.log('   ⚠ This is the ROOT key — for your own devices only. Workshop/class? Use create-room.')
  }
  console.log(`\n   📱 QR card: ${qrFile}`)
  console.log(
    room
      ? '      (fresh apps: scan = full onboarding · configured apps: joins the room only)'
      : '      (PawCards → Settings → 📷 Scan settings QR — each device keeps its own Sync ID)',
  )
  if (process.platform === 'darwin') spawnSync('open', [qrFile])
}

/* ═══════════════ commands ═══════════════ */

if (command === 'deploy') {
  checkLogin()

  console.log('\n② KV namespace (sync docs + deck shares + images)…')
  let kvId: string
  if (/^[0-9a-f]{32}$/.test(profile.kv)) {
    kvId = profile.kv
    console.log(`  ✓ using namespace id from the profile (${kvId})`)
  } else {
    const namespaces = parseJsonArray<{ id: string; title: string }>(
      run([...wrangler, 'kv', 'namespace', 'list'], { quiet: true }),
    )
    const existing = namespaces.find((n) => n.title === profile.kv)
    if (existing) {
      kvId = existing.id
      console.log(`  ✓ reusing existing namespace "${profile.kv}" (${kvId})`)
    } else {
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

  console.log('\n③ Deploying the worker (AI + KV + PawRoom Durable Object)…')
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
      },
      null,
      2,
    ) + '\n',
  )
  const deployOut = run([...wrangler, 'deploy', '--config', configPath])
  const base = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(deployOut)?.[0] ?? `https://${profile.worker}.<your-subdomain>.workers.dev`
  console.log(`  ✓ deployed ${base}`)

  console.log('\n④ Access key…')
  const hasSecret = run([...wrangler, 'secret', 'list', '--config', configPath], { quiet: true }).includes('"SECRET"')
  if (!hasSecret) {
    const key = randomBytes(12).toString('hex')
    run([...wrangler, 'secret', 'put', 'SECRET', '--config', configPath], { input: key, quiet: true })
    writeFileSync(secretPath, JSON.stringify({ url: base, key } satisfies SecretFile, null, 2) + '\n')
    console.log('  ✓ SECRET generated (saved to the gitignored ' + secretPath.split('/').pop() + ')')
    console.log('\n✅ Done! Paste this into PawCards → Settings (endpoint AND sync URL):')
    await handOver(base, key, 'new stack')
  } else {
    // keep the local secret file's url fresh for create-room
    const sf = readSecretFile()
    if (sf) writeFileSync(secretPath, JSON.stringify({ ...sf, url: base }, null, 2) + '\n')
    console.log('  ✓ keeping the existing SECRET (use rotate-key to replace it)')
    console.log(`\n✅ Done! ${base} redeployed — the key in your app settings keeps working.`)
  }
  console.log(`\n   Stack profile: worker/stacks/${profileName}.json — edit names there, re-run deploy to apply.\n`)
}

if (command === 'rotate-key') {
  checkLogin()
  if (!existsSync(configPath)) fail(`no generated config for "${profile.worker}" on this machine — run deploy first`)
  const base = readSecretFile()?.url
  if (!base) fail('the worker URL is not known on this machine yet — run deploy once, then rotate-key')
  const key = randomBytes(12).toString('hex')
  console.log(`\n🔑 Rotating SECRET on "${profile.worker}"…`)
  run([...wrangler, 'secret', 'put', 'SECRET', '--config', configPath], { input: key, quiet: true })
  writeFileSync(secretPath, JSON.stringify({ url: base, key } satisfies SecretFile, null, 2) + '\n')
  console.log('  ✓ rotated — every old key AND every outstanding temp/room invite is now dead')
  console.log('\n✅ Update your own devices with the new key:')
  await handOver(base, key, 'key rotated')
  console.log()
}

if (command === 'create-room') {
  const sf = readSecretFile()
  if (!sf?.key || !sf.url) {
    fail(
      `no saved root key for "${profile.worker}" on this machine (${secretPath.split('/').pop()} missing).\n` +
        '  Run deploy (new stack) or rotate-key (existing stack — old invites stop working) first.',
    )
  }
  const expArg = flagValue('--exp') ?? '30d'
  const dur = parseDuration(expArg)
  if (!dur) fail(`--exp wants a duration like 30d or 12h (got "${expArg}")`)
  const room = {
    code: newRoomCode(),
    name: flagValue('--name') ?? profileName,
    by: flagValue('--host-name'),
    exp: Date.now() + dur,
    shareServer: args.includes('--share-server'),
  }
  console.log(`\n🏫 Creating room invite on "${profile.worker}" (no deploy needed — the key is signed locally)…`)
  await handOver(sf.url, sf.key, 'room invite', room)
  console.log()
}

if (command === 'destroy') {
  checkLogin()
  if (profileName === 'pawcards-polish') fail('refusing to destroy the main stack "pawcards-polish"')
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
    const namespaces = parseJsonArray<{ id: string; title: string }>(
      run([...wrangler, 'kv', 'namespace', 'list'], { quiet: true }),
    )
    const ns = namespaces.find((n) => n.title === profile.kv)
    if (ns) {
      run([...wrangler, 'kv', 'namespace', 'delete', '--namespace-id', ns.id])
      console.log(`  ✓ KV namespace "${profile.kv}" deleted (sync docs, shares, images — all gone)`)
    } else {
      console.log(`  ↷ KV namespace "${profile.kv}" not found — nothing to delete`)
    }
  }
  for (const f of [configPath, secretPath]) {
    try {
      unlinkSync(f)
    } catch {
      /* already gone */
    }
  }
  console.log(`\n✅ Stack destroyed. The profile file worker/stacks/${profileName}.json is kept for your records — delete it if you're done with the name.\n`)
}
