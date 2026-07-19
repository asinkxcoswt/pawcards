import { describe, expect, test } from 'bun:test'
import { shareableCards } from '../src/lib/share'
import type { Card } from '../src/lib/types'

const card = (id: string, deckId: string, priv = false): Card => ({
  id,
  deckId,
  created: 1,
  front: [],
  back: [],
  backText: id,
  private: priv,
  srs: null,
  polished: {},
})

describe('shareableCards', () => {
  const cards = [card('a', 'd1'), card('b', 'd1', true), card('c', 'd1'), card('x', 'd2')]

  test('drops private cards and cards from other decks', () => {
    expect(shareableCards(cards, 'd1').map((c) => c.id)).toEqual(['a', 'c'])
  })

  test('a deck of only private cards shares nothing', () => {
    expect(shareableCards([card('a', 'd1', true)], 'd1')).toHaveLength(0)
  })

  test('cards without the flag are shared (default opt-out)', () => {
    const legacy = { ...card('a', 'd1') } as Card
    delete legacy.private
    expect(shareableCards([legacy], 'd1')).toHaveLength(1)
  })
})
