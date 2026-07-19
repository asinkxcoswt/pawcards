import { describe, expect, test } from 'bun:test'
import { encodeConfig, parseConfig, type ConfigPayload } from '../src/lib/qrconfig'

const sample: ConfigPayload = {
  provider: 'local',
  apiKey: '',
  apiUrl: 'https://paw.example.workers.dev/?key=abc',
  model: '',
  prompt: 'cute flat sticker art',
  syncUrl: 'https://paw.example.workers.dev/?key=abc',
  syncId: 'paw-aaaa-bbbb-cccc',
}

describe('qrconfig', () => {
  test('round-trips a full config', () => {
    expect(parseConfig(encodeConfig(sample))).toEqual(sample)
  })

  test('round-trips gemini config with api key and thai prompt', () => {
    const s: ConfigPayload = {
      ...sample,
      provider: 'gemini',
      apiKey: 'AIzaSyExample123',
      model: 'gemini-2.5-flash-image',
      prompt: 'ภาพวาดน่ารัก สไตล์สติกเกอร์',
    }
    expect(parseConfig(encodeConfig(s))).toEqual(s)
  })

  test('rejects non-JSON', () => {
    expect(() => parseConfig('hello')).toThrow('Not a PawCards settings code')
  })

  test('rejects foreign JSON (random QR / a URL payload)', () => {
    expect(() => parseConfig('{"url":"https://evil.example"}')).toThrow('Not a PawCards settings code')
    expect(() => parseConfig('"https://example.com"')).toThrow('Not a PawCards settings code')
  })

  test('rejects future payload versions', () => {
    const v2 = JSON.stringify({ t: 'pawcards-config', v: 2, s: {} })
    expect(() => parseConfig(v2)).toThrow('newer app version')
  })

  test('sanitizes bad field types instead of importing junk', () => {
    const raw = JSON.stringify({
      t: 'pawcards-config',
      v: 1,
      s: { provider: 'weird', apiKey: 42, syncUrl: 'https://x.example', syncId: null },
    })
    const parsed = parseConfig(raw)
    expect(parsed.provider).toBe('local')
    expect(parsed.apiKey).toBe('')
    expect(parsed.syncUrl).toBe('https://x.example')
    expect(parsed.syncId).toBe('')
  })
})
