import type { Card } from './types'

/**
 * Manual card order within a deck (drag & drop).
 *
 * `card.order` is sparse on purpose: a card that has never been dragged has no
 * `order`, and falls back to `-created` so the default stays **newest first**
 * (what the deck grid always showed). Sorting is ascending on that value.
 *
 * Reordering assigns the moved card a midpoint between its new neighbours, so a
 * drag touches exactly ONE card — important for sync, where every touched card
 * gets a fresh `updated` and wins newest-wins merges. Renumbering the whole deck
 * on each drag would make every card "newest" and could clobber another
 * device's edits.
 */

export const orderOf = (c: Card): number => c.order ?? -c.created

/** deck's cards in display order (manual order, else newest first) */
export function sortDeckCards(cards: Card[], deckId: string): Card[] {
  return cards.filter((c) => c.deckId === deckId).sort((a, b) => orderOf(a) - orderOf(b))
}

/** gap used when dropping at either end of the list */
const END_GAP = 60_000

/**
 * The `order` value that places a card at `toIndex` of `ordered` (the deck's
 * current display order, moved card still included). Returns null when the move
 * is a no-op.
 */
export function orderForMove(ordered: Card[], cardId: string, toIndex: number): number | null {
  const from = ordered.findIndex((c) => c.id === cardId)
  if (from < 0) return null
  const without = ordered.filter((c) => c.id !== cardId)
  const at = Math.max(0, Math.min(toIndex, without.length))
  if (from === at && ordered[at]?.id === cardId) return null // already there

  const before = without[at - 1]
  const after = without[at]
  if (!before && !after) return 0 // only card in the deck
  if (!before) return orderOf(after) - END_GAP // dropped at the very start
  if (!after) return orderOf(before) + END_GAP // dropped at the very end
  return (orderOf(before) + orderOf(after)) / 2
}
