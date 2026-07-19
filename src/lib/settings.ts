import type { Doc, Provider, Settings } from './types'

export function defaultSettings(): Settings {
  return {
    provider: 'gemini',
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1/images/edits',
    model: 'gemini-2.5-flash-image',
    strength: 0.55,
    prompt:
      'cute flat sticker art, one single centered subject, thick smooth outlines, soft pastel colors, plain white background, minimalist, high quality',
    syncUrl: '',
    syncId: '',
    lastSyncAt: 0,
  }
}

export function defaultDoc(): Doc {
  return { version: 1, decks: [], cards: [], tombstones: {}, settings: defaultSettings() }
}

export function providerDefaults(p: Provider): { model: string; apiUrl: string } {
  if (p === 'gemini') return { model: 'gemini-2.5-flash-image', apiUrl: '' }
  if (p === 'local') return { model: '', apiUrl: 'http://127.0.0.1:7860/sdapi/v1/img2img' }
  return { model: 'gpt-image-1', apiUrl: 'https://api.openai.com/v1/images/edits' }
}

/**
 * Fix up settings loaded from older versions of the app.
 * `legacy` = the stored doc predates the provider field (single-file v1.0).
 */
export function migrateSettings(s: Settings, legacy: boolean): Settings {
  const out = { ...defaultSettings(), ...s }
  if (legacy) {
    // Google API keys start with "AIza"; OpenAI keys with "sk-". No key → gemini default.
    out.provider = /^AIza/.test(out.apiKey) ? 'gemini' : out.apiKey ? 'openai' : 'gemini'
  }
  // never let a mismatched model id reach the wrong API
  if (out.provider === 'gemini' && !/gemini|banana|imagen/i.test(out.model)) {
    out.model = providerDefaults('gemini').model
  }
  if (out.provider === 'openai' && /gemini|banana|imagen/i.test(out.model)) {
    out.model = providerDefaults('openai').model
  }
  // old instruction-style prompts confuse SD-class models
  if (/^Redraw this rough sketch/.test(out.prompt)) out.prompt = defaultSettings().prompt
  // upgrade older default styles to the current text-avoiding sticker style
  if (
    out.prompt ===
    'clean simple flat illustration, smooth bold outlines, soft colors, plain white background, cute, high quality'
  ) {
    out.prompt = defaultSettings().prompt
  }
  return out
}
