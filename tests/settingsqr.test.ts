import { describe, expect, test } from 'bun:test'
import { settingsQrSvg, stackConfigPayload } from '../worker/settings-qr'
import { parseConfig } from '../src/lib/qrconfig'
import { defaultSettings } from '../src/lib/settings'

describe('deploy-script settings QR', () => {
  const endpoint = 'https://paw-test.khaan.workers.dev/?key=abc123'

  test('payload is a valid in-app settings config pointing at the stack', () => {
    const cfg = parseConfig(stackConfigPayload(endpoint))
    expect(cfg.provider).toBe('local')
    expect(cfg.apiUrl).toBe(endpoint)
    expect(cfg.syncUrl).toBe(endpoint)
    expect(cfg.apiKey).toBe('')
    expect(cfg.syncId).toBe('') // scanning devices keep their own Sync ID
    expect(cfg.prompt).toBe(defaultSettings().prompt)
  })

  test('svg card embeds the QR and the human-readable environment info', async () => {
    const svg = await settingsQrSvg({
      endpoint,
      worker: 'paw-test',
      host: 'paw-test.khaan.workers.dev',
      note: 'new stack',
      date: '2026-07-19',
    })
    expect(svg).toContain('<svg xmlns')
    expect(svg).toContain('paw-test · paw-test.khaan.workers.dev')
    expect(svg).toContain('Generated 2026-07-19 · new stack')
    expect(svg).toContain('Scan: PawCards → Settings')
    expect(svg).not.toContain('abc123') // the key lives ONLY inside the QR modules, never as text
  })
})
