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
 * Idempotent — safe to re-run anytime. The SECRET is kept across runs and
 * shown only when first generated.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { settingsQrSvg } from './settings-qr'

const workerDir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const rotateKey = args.includes('--rotate-key')
const profileName = args.find((a) => !a.startsWith('--')) ?? 'pawcards-polish'

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
  return (r.stdout ?? '') + (r.stderr ?? '')
}

const wrangler = ['bunx', 'wrangler']

/* 0 ─ profile */
interface Profile {
  worker: string
  kv: string
}
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

console.log(`\n🐾 PawCards worker stack "${profileName}" → worker "${profile.worker}", kv "${profile.kv}"`)

/* 1 ─ auth */
console.log('\n① Checking Cloudflare login…')
const who = spawnSync(wrangler[0], [...wrangler.slice(1), 'whoami'], { cwd: workerDir, encoding: 'utf8' })
if (who.status !== 0 || /not authenticated|login/i.test(who.stdout + who.stderr)) {
  fail('not logged in to Cloudflare. Run once:  bunx wrangler login')
}

/* 2 ─ KV namespace: use id directly, or find-or-create by title */
console.log('\n② KV namespace (sync docs + deck shares)…')
let kvId: string
if (/^[0-9a-f]{32}$/.test(profile.kv)) {
  kvId = profile.kv
  console.log(`  ✓ using namespace id from the profile (${kvId})`)
} else {
  const listOut = run([...wrangler, 'kv', 'namespace', 'list'], { quiet: true })
  const jsonStart = listOut.indexOf('[')
  const namespaces = jsonStart >= 0 ? (JSON.parse(listOut.slice(jsonStart)) as { id: string; title: string }[]) : []
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
  console.log(`   ${base}/?key=${key}\n`)
  console.log('   ⚠ The key is shown ONLY now — it cannot be read back later.')
  // a scannable settings card, styled like the in-app Settings QR sheet
  const qrFile = join(workerDir, `.wrangler.${profile.worker}.qr.svg`)
  writeFileSync(
    qrFile,
    await settingsQrSvg({
      endpoint: `${base}/?key=${key}`,
      worker: profile.worker,
      host: base.replace(/^https:\/\//, ''),
      note: rotateKey ? 'key rotated' : 'new stack',
      date: new Date().toISOString().slice(0, 10),
    }),
  )
  console.log(`\n   📱 Or scan it: ${qrFile}`)
  console.log('      (PawCards → Settings → 📷 Scan settings QR — each device keeps its own Sync ID)')
  if (process.platform === 'darwin') spawnSync('open', [qrFile])
} else {
  console.log(`   ${base}/?key=<your existing key>\n`)
  console.log('   (key unchanged — the one already in your app settings keeps working)')
}
console.log(`\n   Stack profile: worker/stacks/${profileName}.json — edit names there, re-run to apply.\n`)
