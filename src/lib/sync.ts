import { DAY_MS, now } from './constants'
import type { Card, Deck, Doc, RoomRef } from './types'

/**
 * Cloud sync — pull → merge → push against the PawCards Worker's /sync
 * endpoint (Cloudflare KV). Identity is a shared-secret Sync ID; devices
 * with the same ID converge on the same cards. Per-card AND per-deck
 * newest-`updated`-wins (deck renames/colours too); deletions propagate via
 * tombstones (pruned after 90 days).
 */

export interface RemoteDoc {
  decks?: Deck[]
  cards?: Card[]
  tombstones?: Record<string, number>
  rooms?: RoomRef[]
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
  local: Pick<Doc, 'decks' | 'cards' | 'tombstones'> & { rooms?: RoomRef[] },
  remote: RemoteDoc,
  t = now(),
): Pick<Doc, 'decks' | 'cards' | 'tombstones' | 'rooms'> {
  const tomb: Record<string, number> = { ...local.tombstones }
  for (const [id, ts] of Object.entries(remote.tombstones ?? {})) {
    tomb[id] = Math.max(tomb[id] ?? 0, ts)
  }

  // a delete on another device removes the item here (unless recreated later)
  let cards = local.cards.filter((c) => !(tomb[c.id] > stamp(c)))
  let decks = local.decks.filter((d) => !(tomb[d.id] > stamp(d)))

  for (const rd of remote.decks ?? []) {
    if (tomb[rd.id] > stamp(rd)) continue
    const i = decks.findIndex((d) => d.id === rd.id)
    if (i < 0) decks = [...decks, rd]
    else if (stamp(rd) > stamp(decks[i])) decks = decks.map((d, j) => (j === i ? rd : d)) // newest edit wins (rename/color)
  }
  for (const rc of remote.cards ?? []) {
    if (tomb[rc.id] > stamp(rc)) continue
    const i = cards.findIndex((c) => c.id === rc.id)
    if (i < 0) cards = [...cards, rc]
    else if (stamp(rc) > stamp(cards[i])) cards = cards.map((c, j) => (j === i ? rc : c)) // newest edit wins
  }

  // rooms union by code (a "leave" tombstones the room code)
  const roomStamp = (r: RoomRef) => r.updated ?? r.joinedAt
  let rooms = (local.rooms ?? []).filter((r) => !(tomb[r.code] > roomStamp(r)))
  for (const rr of remote.rooms ?? []) {
    if (tomb[rr.code] > roomStamp(rr)) continue
    const i = rooms.findIndex((r) => r.code === rr.code)
    if (i < 0) rooms = [...rooms, rr]
    else if (roomStamp(rr) > roomStamp(rooms[i])) rooms = rooms.map((r, j) => (j === i ? rr : r))
  }

  // prune old tombstones
  const cutoff = t - 90 * DAY_MS
  for (const id of Object.keys(tomb)) if (tomb[id] < cutoff) delete tomb[id]

  return { decks, cards, tombstones: tomb, rooms }
}
