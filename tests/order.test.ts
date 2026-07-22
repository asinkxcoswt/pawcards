import { describe, expect, it } from 'bun:test'
import { orderForMove, orderOf, sortDeckCards } from '../src/lib/order'
import type { Card } from '../src/lib/types'

const card = (id: string, created: number, order?: number, deckId = 'd1'): Card => ({
  id,
  deckId,
  created,
  updated: created,
  front: [],
  back: [],
  backText: id,
  srs: null,
  polished: {},
  ...(order === undefined ? {} : { order }),
})

/** apply a move the way the store does, then read back the resulting order */
function move(cards: Card[], id: string, toIndex: number): string[] {
  const ordered = sortDeckCards(cards, 'd1')
  const o = orderForMove(ordered, id, toIndex)
  const next = o === null ? cards : cards.map((c) => (c.id === id ? { ...c, order: o } : c))
  return sortDeckCards(next, 'd1').map((c) => c.id)
}

describe('default order', () => {
  it('is newest-first when no card has been dragged', () => {
    const cards = [card('old', 1000), card('mid', 2000), card('new', 3000)]
    expect(sortDeckCards(cards, 'd1').map((c) => c.id)).toEqual(['new', 'mid', 'old'])
  })

  it('only includes the requested deck', () => {
    const cards = [card('a', 1), card('b', 2, undefined, 'OTHER')]
    expect(sortDeckCards(cards, 'd1').map((c) => c.id)).toEqual(['a'])
  })

  it('an explicit order wins over created', () => {
    expect(orderOf(card('x', 5000, 42))).toBe(42)
    expect(orderOf(card('x', 5000))).toBe(-5000)
  })
})

describe('orderForMove', () => {
  // display order starts as c, b, a (newest first)
  const cards = [card('a', 1000), card('b', 2000), card('c', 3000)]

  it('moves a card to the front', () => {
    expect(move(cards, 'a', 0)).toEqual(['a', 'c', 'b'])
  })

  it('moves a card to the end', () => {
    expect(move(cards, 'c', 2)).toEqual(['b', 'a', 'c'])
  })

  it('moves a card into the middle', () => {
    expect(move(cards, 'c', 1)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op when dropped where it already is', () => {
    const ordered = sortDeckCards(cards, 'd1') // c, b, a
    expect(orderForMove(ordered, 'c', 0)).toBeNull()
  })

  it('touches only the moved card (sync-friendly)', () => {
    const ordered = sortDeckCards(cards, 'd1')
    const o = orderForMove(ordered, 'a', 0)
    expect(o).not.toBeNull()
    // every other card keeps its (absent) order — nothing else needs rewriting
    expect(cards.filter((c) => c.id !== 'a').every((c) => c.order === undefined)).toBe(true)
  })

  it('survives repeated moves into the same gap', () => {
    let list = [...cards]
    for (let i = 0; i < 12; i++) {
      const ordered = sortDeckCards(list, 'd1')
      const o = orderForMove(ordered, 'a', 1)
      if (o !== null) list = list.map((c) => (c.id === 'a' ? { ...c, order: o } : c))
      // 'a' must sit in the middle every time
      expect(sortDeckCards(list, 'd1')[1].id).toBe('a')
    }
  })

  it('returns null for an unknown card', () => {
    expect(orderForMove(sortDeckCards(cards, 'd1'), 'nope', 0)).toBeNull()
  })
})
