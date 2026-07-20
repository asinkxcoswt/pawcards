import { describe, expect, it } from 'bun:test'
import { encodeInvite, inviteConfig, inviteLink, parseInvite, parseInviteFragment } from '../src/lib/invite'
import { encodeRoomQr, expiresLabel, roomExpired } from '../src/lib/room'

const WORKSHOP = {
  url: 'https://paw-workshop.dev-786.workers.dev/?key=s3cret',
  code: 'room-ab12-cd34',
  name: 'Thai Cooking Workshop',
  by: 'John',
  exp: 1790000000000,
}

describe('invite payload', () => {
  it('round-trips a full workshop invite', () => {
    expect(parseInvite(encodeInvite(WORKSHOP))).toEqual(WORKSHOP)
  })

  it('round-trips a settings-only invite (no room)', () => {
    const p = { url: WORKSHOP.url }
    expect(parseInvite(encodeInvite(p))).toEqual({ url: p.url, code: undefined, name: undefined, by: undefined, exp: undefined })
  })

  it('accepts legacy v1 room QRs', () => {
    const v1 = encodeRoomQr({ url: WORKSHOP.url, code: WORKSHOP.code, name: WORKSHOP.name })
    const p = parseInvite(v1)
    expect(p.url).toBe(WORKSHOP.url)
    expect(p.code).toBe(WORKSHOP.code)
    expect(p.name).toBe(WORKSHOP.name)
    expect(p.exp).toBeUndefined()
  })

  it('rejects junk and foreign payloads with friendly errors', () => {
    expect(() => parseInvite('hello')).toThrow('Not a PawCards invite')
    expect(() => parseInvite('{"t":"pawcards-config","v":1}')).toThrow('Not a PawCards invite')
    expect(() => parseInvite(JSON.stringify({ t: 'pawcards-room', v: 3, url: WORKSHOP.url }))).toThrow(/newer app version/)
    expect(() => parseInvite(JSON.stringify({ t: 'pawcards-room', v: 2, url: 'ftp://x' }))).toThrow(/worker URL/)
    expect(() => parseInvite(JSON.stringify({ t: 'pawcards-room', v: 2, url: WORKSHOP.url, code: 'nope' }))).toThrow(/damaged/)
  })
})

describe('invite link', () => {
  it('builds an app link with openExternalBrowser and a fragment payload', () => {
    const link = inviteLink('https://pawcards.littlepawcraft.com/', WORKSHOP)
    expect(link.startsWith('https://pawcards.littlepawcraft.com/?openExternalBrowser=1#ws=')).toBe(true)
    const u = new URL(link)
    expect(parseInviteFragment(u.hash)).toEqual(WORKSHOP)
  })

  it('survives Thai room names through base64url', () => {
    const p = { ...WORKSHOP, name: 'ห้องเวิร์กช็อปภาษาไทย', by: 'ข่าน' }
    const link = inviteLink('https://pawcards.littlepawcraft.com', p)
    expect(parseInviteFragment(new URL(link).hash)).toEqual(p)
  })

  it('fragment parser ignores hashes without an invite', () => {
    expect(parseInviteFragment('')).toBeNull()
    expect(parseInviteFragment('#foo=bar')).toBeNull()
    expect(parseInviteFragment('#ws=%%%')).toBeNull()
  })
})

describe('room expiry helpers', () => {
  const DAY = 24 * 60 * 60 * 1000
  const t = 1_790_000_000_000

  it('roomExpired: only past a set expiry', () => {
    expect(roomExpired({}, t)).toBe(false)
    expect(roomExpired({ expiresAt: 0 }, t)).toBe(false)
    expect(roomExpired({ expiresAt: t + 1 }, t)).toBe(false)
    expect(roomExpired({ expiresAt: t - 1 }, t)).toBe(true)
  })

  it('expiresLabel: days left / today / expired', () => {
    expect(expiresLabel(t + 12 * DAY + 1000, t)).toBe('12d left')
    expect(expiresLabel(t + 2 * 60 * 60 * 1000, t)).toBe('expires today')
    expect(expiresLabel(t - 1000, t)).toBe('expired')
  })
})

describe('inviteConfig', () => {
  it('derives full main settings from the worker url, with a blank syncId', () => {
    const c = inviteConfig(WORKSHOP)
    expect(c.provider).toBe('local')
    expect(c.apiUrl).toBe(WORKSHOP.url)
    expect(c.syncUrl).toBe(WORKSHOP.url)
    expect(c.syncId).toBe('')
    expect(c.prompt.length).toBeGreaterThan(0)
  })
})
