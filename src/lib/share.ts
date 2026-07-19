import type { Card, Deck } from './types'
import { syncEndpoint } from './sync'

/**
 * Deck sharing — a deck (with images) is far too big for a QR code, so the
 * deck itself is uploaded to the sharer's Worker KV under a `share-…` id and
 * the QR carries only a pointer: {worker url incl ?key=, share id, preview}.
 * The Worker gives share-* entries a TTL (60 days), so links expire.
 */

export interface DeckShareQr {
  /** sharer's worker sync URL incl ?key= — recipients fetch through it */
  url: string
  /** KV id the deck was uploaded under (share-xxxx-xxxx) */
  id: string
  name: string
  by: string
  count: number
}

/** what's stored in KV under the share id (wrapped by the worker in {doc, updatedAt}) */
export interface ShareDoc {
  deck: Deck
  cards: Card[]
  by: string
  at: number
}

const MAGIC = 'pawcards-share'

export function newShareId(): string {
  const chunk = () => Math.random().toString(36).slice(2, 6)
  return 'share-' + chunk() + '-' + chunk() + '-' + chunk()
}

export function encodeShareQr(p: DeckShareQr): string {
  return JSON.stringify({ t: MAGIC, v: 1, ...p })
}

/** Parse a scanned share QR. Throws with a user-facing message on anything invalid. */
export function parseShareQr(text: string): DeckShareQr {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a PawCards deck code')
  }
  const o = raw as Record<string, unknown>
  if (o?.t !== MAGIC) throw new Error('Not a PawCards deck code')
  if (o.v !== 1) throw new Error('This code is from a newer app version — update this device first')
  if (typeof o.url !== 'string' || !/^https?:\/\//.test(o.url)) throw new Error('Share code has no valid worker URL')
  if (typeof o.id !== 'string' || !o.id.startsWith('share-')) throw new Error('Share code has no valid share id')
  return {
    url: o.url,
    id: o.id,
    name: typeof o.name === 'string' ? o.name : 'Shared deck',
    by: typeof o.by === 'string' ? o.by : 'a friend',
    count: typeof o.count === 'number' ? o.count : 0,
  }
}

/** Validate a fetched share doc — recipients import this into their library. */
export function validateShareDoc(raw: unknown): ShareDoc {
  const d = raw as Partial<ShareDoc>
  if (!d || typeof d !== 'object' || !d.deck?.id || !d.deck.name || !Array.isArray(d.cards)) {
    throw new Error('This share is damaged or not a deck')
  }
  const cards = d.cards.filter((c) => c && typeof c.id === 'string' && c.deckId === d.deck!.id)
  return { deck: d.deck as Deck, cards, by: typeof d.by === 'string' ? d.by : 'a friend', at: d.at ?? 0 }
}

/* ---------- KV transport (same worker /sync endpoint the app already uses) ---------- */

export async function kvPut(syncUrl: string, id: string, doc: unknown): Promise<void> {
  const rsp = await fetch(syncEndpoint(syncUrl, id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc }),
  })
  if (!rsp.ok) {
    const e = await rsp.json().catch(() => ({}) as { error?: string })
    throw new Error(e.error ?? 'HTTP ' + rsp.status)
  }
}

export async function kvGet(syncUrl: string, id: string): Promise<unknown> {
  const rsp = await fetch(syncEndpoint(syncUrl, id))
  if (rsp.status === 404) throw new Error('This share has expired or was never uploaded')
  if (!rsp.ok) {
    const e = await rsp.json().catch(() => ({}) as { error?: string })
    throw new Error(e.error ?? 'HTTP ' + rsp.status)
  }
  const body = (await rsp.json()) as { doc?: unknown }
  return body.doc ?? body
}

/** Upload a deck for sharing; returns the QR payload to show. */
export async function uploadDeckShare(syncUrl: string, by: string, deck: Deck, cards: Card[]): Promise<DeckShareQr> {
  const id = newShareId()
  const doc: ShareDoc = { deck, cards, by, at: Date.now() }
  await kvPut(syncUrl, id, doc)
  return { url: syncUrl, id, name: deck.name, by, count: cards.length }
}

/** Fetch + validate a shared deck from a scanned QR payload. */
export async function fetchSharedDeck(qr: DeckShareQr): Promise<ShareDoc> {
  return validateShareDoc(await kvGet(qr.url, qr.id))
}
