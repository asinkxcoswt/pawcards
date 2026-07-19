import type { Provider, Settings } from './types'

/**
 * QR payload for moving configuration (AI generation + cloud sync) between
 * devices. Deliberately excludes per-device state (lastSyncAt) and legacy
 * fields (strength). The QR contains secrets (apiKey, syncId) — the UI must
 * warn the user not to show it around.
 */
export type ConfigPayload = Pick<
  Settings,
  'provider' | 'apiKey' | 'apiUrl' | 'model' | 'prompt' | 'syncUrl' | 'syncId'
>

const MAGIC = 'pawcards-config'
const PROVIDERS: Provider[] = ['local', 'gemini', 'openai']

export function encodeConfig(s: ConfigPayload): string {
  return JSON.stringify({
    t: MAGIC,
    v: 1,
    s: {
      provider: s.provider,
      apiKey: s.apiKey,
      apiUrl: s.apiUrl,
      model: s.model,
      prompt: s.prompt,
      syncUrl: s.syncUrl,
      syncId: s.syncId,
    },
  })
}

/** Parse scanned QR text. Throws with a user-facing message on anything invalid. */
export function parseConfig(text: string): ConfigPayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a PawCards settings code')
  }
  const o = raw as { t?: unknown; v?: unknown; s?: Record<string, unknown> }
  if (o?.t !== MAGIC || !o.s || typeof o.s !== 'object') {
    throw new Error('Not a PawCards settings code')
  }
  if (o.v !== 1) throw new Error('This code is from a newer app version — update this device first')
  const s = o.s
  const str = (k: string) => (typeof s[k] === 'string' ? (s[k] as string) : '')
  const provider = PROVIDERS.includes(s.provider as Provider) ? (s.provider as Provider) : 'local'
  return {
    provider,
    apiKey: str('apiKey'),
    apiUrl: str('apiUrl'),
    model: str('model'),
    prompt: str('prompt'),
    syncUrl: str('syncUrl'),
    syncId: str('syncId'),
  }
}
