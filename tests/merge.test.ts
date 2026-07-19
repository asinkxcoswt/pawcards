import { describe, expect, it } from 'bun:test'
import { DAY_MS } from '../src/lib/constants'
import { mergeRemote, syncEndpoint } from '../src/lib/sync'
import type { Card, Deck } from '../src/lib/types'

const card = (id: string, updated: number, backText = ''): Card => ({
  id,
  deckId: 'd1',
  created: 1,
  updated,
  front: [],
  back: [],
  backText,
  srs: null,
  polished: {},
})
const deck = (id: string): Deck => ({ id, name: id, color: '#000', created: 1 })
const empty = { decks: [] as Deck[], cards: [] as Card[], tombstones: {} as Record<string, number> }

describe('mergeRemote', () => {
  it('pulls unknown decks and cards from remote', () => {
    const m = mergeRemote(empty, { decks: [deck('d1')], cards: [card('a', 10)] })
    expect(m.decks).toHaveLength(1)
    expect(m.cards).toHaveLength(1)
  })

  it('newest edit wins per card, either direction', () => {
    const localNewer = mergeRemote(
      { ...empty, cards: [card('a', 20, 'local')] },
      { cards: [card('a', 10, 'remote')] },
    )
    expect(localNewer.cards[0].backText).toBe('local')

    const remoteNewer = mergeRemote(
      { ...empty, cards: [card('a', 10, 'local')] },
      { cards: [card('a', 20, 'remote')] },
    )
    expect(remoteNewer.cards[0].backText).toBe('remote')
  })

  it('remote tombstone deletes the local card', () => {
    const m = mergeRemote({ ...empty, cards: [card('a', 10)] }, { tombstones: { a: 99 } }, 100)
    expect(m.cards).toHaveLength(0)
    expect(m.tombstones.a).toBe(99)
  })

  it('local tombstone blocks a stale remote card from resurrecting', () => {
    const m = mergeRemote({ ...empty, tombstones: { a: 99 } }, { cards: [card('a', 10)] })
    expect(m.cards).toHaveLength(0)
  })

  it('a card edited AFTER its tombstone survives (recreate wins)', () => {
    const m = mergeRemote({ ...empty, tombstones: { a: 50 } }, { cards: [card('a', 60)] })
    expect(m.cards).toHaveLength(1)
  })

  it('keeps local-only additions', () => {
    const m = mergeRemote({ ...empty, cards: [card('mine', 10)] }, { cards: [card('theirs', 10)] })
    expect(m.cards.map((c) => c.id).sort()).toEqual(['mine', 'theirs'])
  })

  it('prunes tombstones older than 90 days', () => {
    const t = 100 * DAY_MS
    const m = mergeRemote({ ...empty, tombstones: { old: 1 * DAY_MS, fresh: 95 * DAY_MS } }, {}, t)
    expect(m.tombstones.old).toBeUndefined()
    expect(m.tombstones.fresh).toBeDefined()
  })

  it('does not mutate its inputs', () => {
    const local = { ...empty, cards: [card('a', 10)] }
    mergeRemote(local, { tombstones: { a: 99 } })
    expect(local.cards).toHaveLength(1)
    expect(local.tombstones).toEqual({})
  })
})

describe('syncEndpoint', () => {
  it('builds /sync from a worker URL with embedded key', () => {
    expect(syncEndpoint('https://w.example.workers.dev/?key=s3cret', 'paw-ab-cd-ef')).toBe(
      'https://w.example.workers.dev/sync?key=s3cret&id=paw-ab-cd-ef',
    )
  })
})
