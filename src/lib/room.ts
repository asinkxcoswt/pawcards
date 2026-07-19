import { useCallback, useEffect, useRef, useState } from 'react'
import type { Card, Deck } from './types'
import { kvGet, uploadDeckShare, validateShareDoc, type ShareDoc } from './share'

/**
 * Workshop rooms — live state lives in a PawRoom Durable Object on the room
 * creator's worker (`wss://…/room/<code>`); the object pushes the full room
 * state to every connected phone on any change, so there is nothing to
 * manually refresh. Deck payloads stay in KV (`share-…`), the room only
 * carries small pointers (RoomDeckMeta). The first person to connect names
 * the room and becomes its host; presence = currently open sockets.
 */

export interface RoomQr {
  url: string
  code: string
  name: string
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

export interface RoomState {
  name: string
  host: string
  createdAt: number
  members: { memberId: string; name: string }[]
  decks: RoomDeckMeta[]
}

export type RoomStatus = 'connecting' | 'live' | 'error'

const MAGIC = 'pawcards-room'
const chunk = () => Math.random().toString(36).slice(2, 6)

export function newRoomCode(): string {
  return 'room-' + chunk() + '-' + chunk()
}

export function newMemberId(): string {
  return chunk() + chunk()
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

export function roomSocketUrl(url: string, code: string, memberId: string, name: string, roomName: string): string {
  const u = new URL(url)
  const proto = u.protocol === 'http:' ? 'ws:' : 'wss:'
  const q = new URLSearchParams({ key: u.searchParams.get('key') ?? '', member: memberId, name, room: roomName })
  return proto + '//' + u.host + '/room/' + code + '?' + q.toString()
}

/**
 * Live connection to a room. Reconnects automatically (phones lock, wifi
 * blips); `status` turns 'error' only when the room never answered — which
 * usually means the worker isn't deployed with room support yet.
 */
export function useRoom(
  ref: { url: string; code: string; memberId: string; name: string } | undefined,
  myName: string,
): { state: RoomState | null; status: RoomStatus; send: (msg: object) => void } {
  const [state, setState] = useState<RoomState | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const wsRef = useRef<WebSocket | null>(null)

  const send = useCallback((msg: object) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }, [])

  const url = ref?.url
  const code = ref?.code
  const memberId = ref?.memberId
  const roomName = ref?.name

  useEffect(() => {
    if (!url || !code || !memberId) return
    let stopped = false
    let attempts = 0
    let everLive = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const connect = () => {
      const ws = new WebSocket(roomSocketUrl(url, code, memberId, myName || 'me', roomName ?? 'Room'))
      wsRef.current = ws
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string) as RoomState & { type?: string }
          if (m.type === 'state') {
            everLive = true
            attempts = 0
            setStatus('live')
            setState(m)
          }
        } catch {
          /* ignore non-JSON frames */
        }
      }
      ws.onclose = () => {
        if (stopped) return
        attempts++
        setStatus(everLive ? 'connecting' : attempts >= 2 ? 'error' : 'connecting')
        timer = setTimeout(connect, Math.min(5000, 1000 * attempts))
      }
      ws.onerror = () => {
        try {
          ws.close()
        } catch {
          /* already closed */
        }
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(timer)
      try {
        wsRef.current?.close()
      } catch {
        /* already closed */
      }
      wsRef.current = null
    }
  }, [url, code, memberId, roomName, myName])

  return { state, status, send }
}

/**
 * Share a deck into a room: full payload (with images) goes to KV on the
 * room's worker like any deck share; the room socket announces the pointer.
 */
export async function shareDeckToRoom(
  roomUrl: string,
  by: string,
  deck: Deck,
  cards: Card[],
  send: (msg: object) => void,
): Promise<void> {
  const qr = await uploadDeckShare(roomUrl, by, deck, cards)
  const meta: RoomDeckMeta = { shareId: qr.id, deckId: deck.id, name: deck.name, by, count: cards.length, at: Date.now() }
  send({ type: 'share-deck', meta })
}

/** Fetch a room deck's full payload (from the room worker's KV) for import. */
export async function fetchRoomDeck(roomUrl: string, meta: RoomDeckMeta): Promise<ShareDoc> {
  return validateShareDoc(await kvGet(roomUrl, meta.shareId))
}
