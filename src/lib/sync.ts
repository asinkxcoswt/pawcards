import { DAY_MS, now } from './constants'
import type { Card, Deck, Doc } from './types'

/**
 * Cloud sync — pull → merge → push against the PawCards Worker's /sync
 * endpoint (Cloudflare KV). Identity is a shared-secret Sync ID; devices
 * with the same ID converge on the same cards. Per-card newest-edit-wins;
 * deletions propagate via tombstones (pruned after 90 days).
 */

export interface RemoteDoc {
  decks?: Deck[]
  cards?: Card[]
  tombstones?: Record<string, number>
}

export function syncConfigured(s: { syncUrl: string; syncId: string }): boolean {
  return !!(s.syncUrl && s.syncId && s.syncId.length >= 8)
}

export function syncEndpoint(syncUrl: string, syncId: string): string {
  const u = new URL(syncUrl)
  const key = u.searchParams.get('key') ?? ''
  return u.origin + '/sync?key=' + encodeURIComponent(key) + '&id=' + encodeURIComponent(syncId)
}

const stamp = (x: { updated?: number; created?: number } | undefined): number =>
  (x && (x.updated ?? x.created)) || 0

/**
 * Merge a remote doc into local decks/cards/tombstones. Pure: returns new
 * arrays/objects; does not mutate inputs.
 */
export function mergeRemote(
  local: Pick<Doc, 'decks' | 'cards' | 'tombstones'>,
  remote: RemoteDoc,
  t = now(),
): Pick<Doc, 'decks' | 'cards' | 'tombstones'> {
  const tomb: Record<string, number> = { ...local.tombstones }
  for (const [id, ts] of Object.entries(remote.tombstones ?? {})) {
    tomb[id] = Math.max(tomb[id] ?? 0, ts)
  }

  // a delete on another device removes the item here (unless recreated later)
  let cards = local.cards.filter((c) => !(tomb[c.id] > stamp(c)))
  let decks = local.decks.filter((d) => !(tomb[d.id] > stamp(d)))

  for (const rd of remote.decks ?? []) {
    if (tomb[rd.id] > stamp(rd)) continue
    if (!decks.some((d) => d.id === rd.id)) decks = [...decks, rd]
  }
  for (const rc of remote.cards ?? []) {
    if (tomb[rc.id] > stamp(rc)) continue
    const i = cards.findIndex((c) => c.id === rc.id)
    if (i < 0) cards = [...cards, rc]
    else if (stamp(rc) > stamp(cards[i])) cards = cards.map((c, j) => (j === i ? rc : c)) // newest edit wins
  }

  // prune old tombstones
  const cutoff = t - 90 * DAY_MS
  for (const id of Object.keys(tomb)) if (tomb[id] < cutoff) delete tomb[id]

  return { decks, cards, tombstones: tomb }
}
