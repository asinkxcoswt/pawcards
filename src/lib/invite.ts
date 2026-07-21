import { b64uDecode, b64uEncode } from './b64url'
import type { ConfigPayload } from './qrconfig'
import { defaultSettings } from './settings'
import { keyGrantsServer } from './tempkey'

/** true when opening this invite may adopt its worker as the app's own settings
 *  (its key grants generation + sync). A room-only key (pr_) returns false, so
 *  the guest joins the room WITHOUT getting the host's server. */
export function inviteGrantsServer(url: string): boolean {
  try {
    return keyGrantsServer(new URL(url).searchParams.get('key') ?? '')
  } catch {
    return false
  }
}

/**
 * Invite payload — the generalized room QR (v2) that doubles as the
 * ready-to-share onboarding link. One format, two containers:
 *
 *   QR:    JSON string (same `pawcards-room` magic; v2 adds by/exp)
 *   link:  https://<app>/?openExternalBrowser=1#ws=<base64url(JSON)>
 *          (fragment → the secret never reaches server logs or Line's
 *           link-preview crawler; openExternalBrowser=1 makes Line open
 *           the real browser instead of its in-app webview)
 *
 * `url` is the whole configuration: a PawCards worker serves generation,
 * sync AND rooms from one origin, so a fresh app can derive its entire
 * main settings from it (inviteConfig). Configured apps only join the room.
 */

export interface InvitePayload {
  /** worker url incl ?key= — settings + room server in one */
  url: string
  /** room to join; absent = settings-only invite */
  code?: string
  /** room display name */
  name?: string
  /** host display name ("John invites you…") */
  by?: string
  /** ms epoch when the server (workshop stack) or room expires */
  exp?: number
}

const MAGIC = 'pawcards-room'

export function encodeInvite(p: InvitePayload): string {
  return JSON.stringify({
    t: MAGIC,
    v: 2,
    url: p.url,
    ...(p.code ? { code: p.code } : {}),
    ...(p.name ? { name: p.name } : {}),
    ...(p.by ? { by: p.by } : {}),
    ...(p.exp ? { exp: p.exp } : {}),
  })
}

/** Parse a scanned/linked invite. Accepts v1 room QRs (url/code/name only). */
export function parseInvite(text: string): InvitePayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a PawCards invite')
  }
  const o = raw as Record<string, unknown>
  if (o?.t !== MAGIC) throw new Error('Not a PawCards invite')
  if (o.v !== 1 && o.v !== 2) throw new Error('This invite is from a newer app version — update this device first')
  if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) throw new Error('Invite has no valid worker URL')
  if (o.code !== undefined && (typeof o.code !== 'string' || !o.code.startsWith('room-'))) {
    throw new Error('Invite room code is damaged')
  }
  return {
    url: o.url,
    code: typeof o.code === 'string' ? o.code : undefined,
    name: typeof o.name === 'string' ? o.name : undefined,
    by: typeof o.by === 'string' ? o.by : undefined,
    exp: typeof o.exp === 'number' && o.exp > 0 ? o.exp : undefined,
  }
}

/* ---------- link container (#ws= fragment) ---------- */

export function inviteLink(appOrigin: string, p: InvitePayload): string {
  const base = appOrigin.replace(/\/+$/, '')
  return base + '/?openExternalBrowser=1#ws=' + b64uEncode(encodeInvite(p))
}

/** Extract an invite from a location hash; null when the hash carries none. */
export function parseInviteFragment(hash: string): InvitePayload | null {
  const m = /[#&]ws=([A-Za-z0-9_-]+)/.exec(hash)
  if (!m) return null
  try {
    return parseInvite(b64uDecode(m[1]))
  } catch {
    return null
  }
}

/** Main settings a fresh app derives from an invite (each device mints its own syncId). */
export function inviteConfig(p: InvitePayload): ConfigPayload {
  const d = defaultSettings()
  return {
    provider: 'local',
    apiKey: '',
    apiUrl: p.url,
    model: d.model,
    prompt: d.prompt,
    syncUrl: p.url,
    syncId: '',
  }
}
