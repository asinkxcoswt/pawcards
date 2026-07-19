import { describe, expect, it } from 'bun:test'
import { defaultSettings, migrateSettings } from '../src/lib/settings'
import { describePrompt, instructPrompt } from '../src/lib/prompts'

describe('settings migration', () => {
  it('legacy v1.0 settings with a Google key pick gemini + gemini model', () => {
    const s = migrateSettings({ ...defaultSettings(), apiKey: 'AIza-test', model: 'gpt-image-1' }, true)
    expect(s.provider).toBe('gemini')
    expect(s.model).toBe('gemini-2.5-flash-image')
  })

  it('legacy v1.0 settings with an OpenAI key pick openai + keep gpt model', () => {
    const s = migrateSettings(
      { ...defaultSettings(), apiKey: 'sk-test', model: 'gpt-image-1', provider: 'openai' },
      true,
    )
    expect(s.provider).toBe('openai')
    expect(s.model).toBe('gpt-image-1')
  })

  it('old instruction-style prompt is replaced', () => {
    const s = migrateSettings(
      { ...defaultSettings(), prompt: 'Redraw this rough sketch as a clean, charming, polished illustration.' },
      false,
    )
    expect(s.prompt).toBe(defaultSettings().prompt)
  })

  it('previous default style upgrades to sticker style; custom styles survive', () => {
    const old = migrateSettings(
      {
        ...defaultSettings(),
        prompt:
          'clean simple flat illustration, smooth bold outlines, soft colors, plain white background, cute, high quality',
      },
      false,
    )
    expect(old.prompt).toStartWith('cute flat sticker art')

    const custom = migrateSettings({ ...defaultSettings(), prompt: 'my watercolor style' }, false)
    expect(custom.prompt).toBe('my watercolor style')
  })
})

describe('prompt building', () => {
  const s = defaultSettings()

  it('describe = subject + style (SD/Flux path)', () => {
    expect(describePrompt(s, 'osmosis moves water')).toBe('osmosis moves water, ' + s.prompt)
  })

  it('instruct wraps subject + style for instruction-following models', () => {
    const p = instructPrompt(s, 'a bird')
    expect(p).toContain('Create an illustration of a bird')
    expect(p).toContain(s.prompt)
  })

  it('the default style never mentions text (negation-blindness lesson)', () => {
    expect(/text|letter|word|writing/i.test(s.prompt)).toBe(false)
  })
})
