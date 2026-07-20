/**
 * Stateless temporary access keys (v3.13) — a signed capability standing in
 * for the worker's root SECRET wherever `?key=` is accepted:
 *
 *   pt_<base64url(exp)>.<base64url(HMAC_SHA256(rootKey, "pawtemp:" + exp))>
 *
 * - Only a ROOT key holder can mint (HMAC needs the root) — "root-only
 *   minting" is cryptographic, not policy. Attendees holding a pt_ key
 *   reshare that same key instead.
 * - `exp` (ms epoch) is inside the signed blob — tampering breaks the MAC.
 * - Rotating the root SECRET invalidates every temp key instantly (the
 *   worker recomputes the MAC with the new root). No storage, no KV.
 *
 * The worker holds the mirror verify logic in plain JS (pawcards-worker.js
 * authKey) — keep the two in sync.
 */

export const TEMP_KEY_PREFIX = 'pt_'

const b64u = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(rootKey: string, exp: number): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(rootKey), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('pawtemp:' + exp))
  return b64u(new Uint8Array(sig))
}

export function isTempKey(key: string): boolean {
  return key.startsWith(TEMP_KEY_PREFIX)
}

/** expiry (ms epoch) encoded in a temp key, or null if it isn't one / is damaged */
export function tempKeyExp(key: string): number | null {
  if (!isTempKey(key)) return null
  const dot = key.indexOf('.')
  if (dot < 0) return null
  try {
    const exp = Number(atob(key.slice(TEMP_KEY_PREFIX.length, dot).replace(/-/g, '+').replace(/_/g, '/')))
    return Number.isFinite(exp) && exp > 0 ? exp : null
  } catch {
    return null
  }
}

/** sign a temp key that the worker will accept until `exp` (needs the ROOT key) */
export async function mintTempKey(rootKey: string, exp: number): Promise<string> {
  const expB = b64u(new TextEncoder().encode(String(exp)))
  return TEMP_KEY_PREFIX + expB + '.' + (await hmac(rootKey, exp))
}

/** verify a temp key against the root (mirror of the worker's check) */
export async function verifyTempKey(key: string, rootKey: string, t = Date.now()): Promise<boolean> {
  const exp = tempKeyExp(key)
  if (exp === null || t > exp) return false
  const expected = await mintTempKey(rootKey, exp)
  return key === expected
}

/**
 * Rewrite a worker URL's ?key= to a temp key expiring at `exp`. When the
 * URL already carries a temp key (an attendee re-sharing), it is returned
 * unchanged — only root holders can mint.
 */
export async function urlWithTempKey(url: string, exp: number): Promise<string> {
  const u = new URL(url)
  const key = u.searchParams.get('key') ?? ''
  if (!key || isTempKey(key)) return url
  u.searchParams.set('key', await mintTempKey(key, exp))
  return u.toString()
}
