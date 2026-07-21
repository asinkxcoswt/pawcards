import { describe, expect, test } from 'bun:test'
import {
  deckShareLink,
  encodeShareQr,
  newShareId,
  parseDeckShareFragment,
  parseShareQr,
  validateShareDoc,
  type DeckShareQr,
} from '../src/lib/share'
import type { Card, Deck } from '../src/lib/types'

const qr: DeckShareQr = {
  url: 'https://paw.example.workers.dev/?key=abc',
  id: 'share-aaaa-bbbb-cccc',
  name: 'Thai Cooking Workshop',
  by: 'Khaan',
  count: 12,
}

const deck: Deck = { id: 'd1', name: 'Workshop', color: '#eee', created: 1 }
const card = (id: string, deckId = 'd1'): Card => ({
  id,
  deckId,
  created: 1,
  front: [],
  back: [],
  backText: 'x',
  srs: null,
  polished: {},
})

describe('deck share QR', () => {
  test('round-trips', () => {
    expect(parseShareQr(encodeShareQr(qr))).toEqual(qr)
  })

  test('share ids look like share-xxxx-xxxx-xxxx', () => {
    expect(newShareId()).toMatch(/^share-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/)
  })

  test('rejects non-JSON, foreign JSON, and settings QRs', () => {
    expect(() => parseShareQr('hello')).toThrow('Not a PawCards deck code')
    expect(() => parseShareQr('{"t":"pawcards-config","v":1,"s":{}}')).toThrow('Not a PawCards deck code')
  })

  test('rejects future versions and broken pointers', () => {
    expect(() => parseShareQr(JSON.stringify({ t: 'pawcards-share', v: 2 }))).toThrow('newer app version')
    expect(() => parseShareQr(JSON.stringify({ t: 'pawcards-share', v: 1, url: 'ftp://x', id: 'share-a' }))).toThrow(
      'worker URL',
    )
    expect(() =>
      parseShareQr(JSON.stringify({ t: 'pawcards-share', v: 1, url: 'https://x.dev/?key=1', id: 'paw-not-a-share' })),
    ).toThrow('share id')
  })
})

describe('deck share link (#deck= fragment)', () => {
  test('builds an app link with openExternalBrowser + a fragment payload', () => {
    const link = deckShareLink('https://pawcards.littlepawcraft.com/', qr)
    expect(link.startsWith('https://pawcards.littlepawcraft.com/?openExternalBrowser=1#deck=')).toBe(true)
    expect(parseDeckShareFragment(new URL(link).hash)).toEqual(qr)
  })

  test('survives Thai deck names through base64url', () => {
    const p = { ...qr, name: 'สำรับอาหารไทย', by: 'ข่าน' }
    expect(parseDeckShareFragment(new URL(deckShareLink('https://x.app', p)).hash)).toEqual(p)
  })

  test('ignores hashes without a deck payload (incl. a room invite)', () => {
    expect(parseDeckShareFragment('')).toBeNull()
    expect(parseDeckShareFragment('#ws=abc')).toBeNull()
    expect(parseDeckShareFragment('#deck=%%%')).toBeNull()
  })
})

describe('share doc validation', () => {
  test('accepts a valid doc and drops cards from other decks', () => {
    const doc = validateShareDoc({ deck, cards: [card('c1'), card('c2', 'OTHER')], by: 'K', at: 5 })
    expect(doc.cards.map((c) => c.id)).toEqual(['c1'])
    expect(doc.by).toBe('K')
  })

  test('rejects docs without a deck or cards array', () => {
    expect(() => validateShareDoc({ cards: [] })).toThrow('damaged')
    expect(() => validateShareDoc({ deck, cards: 'no' })).toThrow('damaged')
    expect(() => validateShareDoc(null)).toThrow('damaged')
  })
})
