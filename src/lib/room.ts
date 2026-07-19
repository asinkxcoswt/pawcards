import type { Card, Deck } from './types'
import { kvGet, kvList, kvPut, uploadDeckShare, validateShareDoc, type ShareDoc } from './share'

/**
 * Workshop rooms — everything lives in KV on the room creator's worker:
 *   room-xxxx-xxxx               RoomDoc {name, host, createdAt}
 *   room-xxxx-xxxx-member-<id>   RoomMember {name, at}
 *   room-xxxx-xxxx-deck-<deckId> RoomDeckMeta (points at a share-… payload)
 * Members and decks are separate keys (found via ?list=) so joins/shares
 * never race on one shared doc. Deck metas are keyed by the sharer's deck id,
 * so re-sharing the same deck replaces its entry instead of duplicating.
 */

export interface RoomQr {
  url: string
  code: string
  name: string
}

export interface RoomDoc {
  name: string
  host: string
  createdAt: number
}

export interface RoomMember {
  name: string
  at: number
}

export interface RoomDeckMeta {
  /** KV id of the full ShareDoc payload */
  shareId: string
  deckId: string
  name: string
  by: string
  count: number
  at: number
}

const MAGIC = 'pawcards-room'
const chunk = () => Math.random().toString(36).slice(2, 6)

export function newRoomCode(): string {
  return 'room-' + chunk() + '-' + chunk()
}

export function encodeRoomQr(p: RoomQr): string {
  return JSON.stringify({ t: MAGIC, v: 1, ...p })
}

export function parseRoomQr(text: string): RoomQr {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a PawCards room code')
  }
  const o = raw as Record<string, unknown>
  if (o?.t !== MAGIC) throw new Error('Not a PawCards room code')
  if (o.v !== 1) throw new Error('This code is from a newer app version — update this device first')
  if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) throw new Error('Room code has no valid worker URL')
  if (typeof o.code !== 'string' || !o.code.startsWith('room-')) throw new Error('Room code is damaged')
  return { url: o.url, code: o.code, name: typeof o.name === 'string' ? o.name : 'Room' }
}

/* ---------- room API (all against the room's worker `url`) ---------- */

export async function createRoom(url: string, name: string, host: string): Promise<string> {
  const code = newRoomCode()
  const doc: RoomDoc = { name, host, createdAt: Date.now() }
  await kvPut(url, code, doc)
  return code
}

export async function fetchRoom(url: string, code: string): Promise<RoomDoc> {
  const d = (await kvGet(url, code)) as Partial<RoomDoc>
  if (!d || typeof d.name !== 'string') throw new Error('This room has expired or was deleted')
  return { name: d.name, host: typeof d.host === 'string' ? d.host : '?', createdAt: d.createdAt ?? 0 }
}

export async function joinRoom(url: string, code: string, memberId: string, name: string): Promise<void> {
  await kvPut(url, code + '-member-' + memberId, { name, at: Date.now() } satisfies RoomMember)
}

export async function fetchMembers(url: string, code: string): Promise<RoomMember[]> {
  const ids = await kvList(url, code + '-member-')
  const members = await Promise.all(
    ids.map((id) =>
      kvGet(url, id)
        .then((m) => m as RoomMember)
        .catch(() => null),
    ),
  )
  return members.filter((m): m is RoomMember => !!m?.name).sort((a, b) => a.at - b.at)
}

export async function fetchRoomDecks(url: string, code: string): Promise<RoomDeckMeta[]> {
  const ids = await kvList(url, code + '-deck-')
  const metas = await Promise.all(
    ids.map((id) =>
      kvGet(url, id)
        .then((m) => m as RoomDeckMeta)
        .catch(() => null),
    ),
  )
  return metas.filter((m): m is RoomDeckMeta => !!m?.shareId).sort((a, b) => a.at - b.at)
}

/** Upload a deck into the room: full payload as share-…, tiny meta under the room. */
export async function shareDeckToRoom(url: string, code: string, by: string, deck: Deck, cards: Card[]): Promise<void> {
  const qr = await uploadDeckShare(url, by, deck, cards)
  const meta: RoomDeckMeta = { shareId: qr.id, deckId: deck.id, name: deck.name, by, count: cards.length, at: Date.now() }
  await kvPut(url, code + '-deck-' + deck.id, meta)
}

/** Fetch a room deck's full payload for import. */
export async function fetchRoomDeck(url: string, meta: RoomDeckMeta): Promise<ShareDoc> {
  return validateShareDoc(await kvGet(url, meta.shareId))
}
