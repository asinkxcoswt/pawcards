import { describe, expect, test } from 'bun:test'
import { encodeRoomQr, newRoomCode, parseRoomQr } from '../src/lib/room'
import { mergeRemote } from '../src/lib/sync'
import type { RoomRef } from '../src/lib/types'

describe('room QR', () => {
  const qr = { url: 'https://paw.example.workers.dev/?key=abc', code: 'room-ab12-cd34', name: 'Thai Cooking' }

  test('round-trips', () => {
    expect(parseRoomQr(encodeRoomQr(qr))).toEqual(qr)
  })

  test('codes look like room-xxxx-xxxx', () => {
    expect(newRoomCode()).toMatch(/^room-[a-z0-9]{4}-[a-z0-9]{4}$/)
  })

  test('rejects junk, share QRs, and future versions', () => {
    expect(() => parseRoomQr('nope')).toThrow('Not a PawCards room code')
    expect(() => parseRoomQr('{"t":"pawcards-share","v":1}')).toThrow('Not a PawCards room code')
    expect(() => parseRoomQr(JSON.stringify({ t: 'pawcards-room', v: 9 }))).toThrow('newer app version')
  })
})

describe('room refs sync via mergeRemote', () => {
  const ref = (code: string, joinedAt: number, updated?: number): RoomRef => ({
    code,
    url: 'https://x.dev/?key=1',
    name: code,
    memberId: 'm1',
    joinedAt,
    updated,
  })
  const base = { decks: [], cards: [], tombstones: {} }

  test('union by code, newest wins', () => {
    const out = mergeRemote(
      { ...base, rooms: [ref('room-a', 10), ref('room-b', 10, 20)] },
      { rooms: [ref('room-b', 10, 30), ref('room-c', 5)] },
      1000,
    )
    expect(out.rooms.map((r) => r.code).sort()).toEqual(['room-a', 'room-b', 'room-c'])
    expect(out.rooms.find((r) => r.code === 'room-b')!.updated).toBe(30)
  })

  test('a leave (tombstone) removes the room on other devices', () => {
    const out = mergeRemote({ ...base, rooms: [ref('room-a', 10)] }, { tombstones: { 'room-a': 50 }, rooms: [] }, 1000)
    expect(out.rooms).toHaveLength(0)
  })

  test('re-joining after a leave wins if newer', () => {
    const out = mergeRemote(
      { ...base, tombstones: { 'room-a': 50 }, rooms: [] },
      { rooms: [ref('room-a', 10, 60)] },
      1000,
    )
    expect(out.rooms.map((r) => r.code)).toEqual(['room-a'])
  })

  test('docs without rooms still merge (old app versions)', () => {
    const out = mergeRemote(base, {}, 1000)
    expect(out.rooms).toEqual([])
  })
})
