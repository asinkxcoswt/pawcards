import { describe, expect, it } from 'bun:test'
import {
  isShareKey,
  isTempKey,
  mintShareKey,
  mintTempKey,
  tempKeyExp,
  urlWithShareKey,
  urlWithTempKey,
  verifyShareKey,
  verifyTempKey,
} from '../src/lib/tempkey'

const ROOT = 'a1b2c3d4e5f60718293a4b5c'
const FUTURE = Date.now() + 30 * 24 * 60 * 60 * 1000
const PAST = Date.now() - 1000

describe('temp keys', () => {
  it('mints pt_-prefixed keys that round-trip their expiry', async () => {
    const key = await mintTempKey(ROOT, FUTURE)
    expect(isTempKey(key)).toBe(true)
    expect(tempKeyExp(key)).toBe(FUTURE)
  })

  it('verifies against the minting root, and only that root', async () => {
    const key = await mintTempKey(ROOT, FUTURE)
    expect(await verifyTempKey(key, ROOT)).toBe(true)
    expect(await verifyTempKey(key, 'some-other-root')).toBe(false) // rotation kills it
  })

  it('rejects expired keys even with the right root', async () => {
    const key = await mintTempKey(ROOT, PAST)
    expect(await verifyTempKey(key, ROOT)).toBe(false)
  })

  it('rejects a tampered expiry (the exp is inside the MAC)', async () => {
    const key = await mintTempKey(ROOT, PAST)
    const extended = await mintTempKey(ROOT, FUTURE)
    // splice the future exp header onto the old signature
    const forged = extended.slice(0, extended.indexOf('.')) + key.slice(key.indexOf('.'))
    expect(await verifyTempKey(forged, ROOT)).toBe(false)
  })

  it('rejects junk shapes', async () => {
    expect(tempKeyExp('not-a-temp-key')).toBeNull()
    expect(tempKeyExp('pt_nodot')).toBeNull()
    expect(await verifyTempKey('pt_%%%.sig', ROOT)).toBe(false)
  })

  it('keys are URL-safe (no padding, +, /)', async () => {
    const key = await mintTempKey(ROOT, FUTURE)
    expect(key).toMatch(/^pt_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })
})

describe('scoped share keys', () => {
  const SHARE = 'share-aaaa-bbbb-cccc'

  it('mints ps_-prefixed keys bound to one id', async () => {
    const key = await mintShareKey(ROOT, SHARE, FUTURE)
    expect(isShareKey(key)).toBe(true)
    expect(isTempKey(key)).toBe(false)
  })

  it('verifies only for the exact id it was minted for', async () => {
    const key = await mintShareKey(ROOT, SHARE, FUTURE)
    expect(await verifyShareKey(key, ROOT, SHARE)).toBe(true)
    expect(await verifyShareKey(key, ROOT, 'share-other-deck-xx')).toBe(false) // wrong deck
    expect(await verifyShareKey(key, 'other-root', SHARE)).toBe(false) // rotation kills it
  })

  it('rejects expired share keys', async () => {
    expect(await verifyShareKey(await mintShareKey(ROOT, SHARE, PAST), ROOT, SHARE)).toBe(false)
  })

  it('urlWithShareKey swaps a root key; leaves temp/share urls untouched', async () => {
    const scoped = await urlWithShareKey('https://paw.example.workers.dev/?key=' + ROOT, SHARE, FUTURE)
    const key = new URL(scoped).searchParams.get('key')!
    expect(isShareKey(key)).toBe(true)
    expect(await verifyShareKey(key, ROOT, SHARE)).toBe(true)
    // an attendee holding a temp key can't mint — reshares as-is
    const tempUrl = await urlWithTempKey('https://paw.example.workers.dev/?key=' + ROOT, FUTURE)
    expect(await urlWithShareKey(tempUrl, SHARE, FUTURE)).toBe(tempUrl)
  })
})

describe('worker authKey / authShareKey (mirror cross-check)', () => {
  const SHARE = 'share-aaaa-bbbb-cccc'
  it('accepts root, lib-minted temp keys, and nothing else', async () => {
    // @ts-expect-error plain-JS worker module
    const { authKey } = await import('../worker/pawcards-worker.js')
    expect(await authKey(ROOT, ROOT)).toBe(true)
    expect(await authKey(await mintTempKey(ROOT, FUTURE), ROOT)).toBe(true)
    expect(await authKey(await mintTempKey(ROOT, PAST), ROOT)).toBe(false)
    expect(await authKey(await mintTempKey('other-root', FUTURE), ROOT)).toBe(false)
    expect(await authKey('wrong', ROOT)).toBe(false)
    expect(await authKey('', ROOT)).toBe(false)
    expect(await authKey('anything', '')).toBe(true) // no SECRET configured = open worker
    // a scoped share token is NOT a general key
    expect(await authKey(await mintShareKey(ROOT, SHARE, FUTURE), ROOT)).toBe(false)
  })

  it('authShareKey accepts a lib-minted share key only for its bound id', async () => {
    // @ts-expect-error plain-JS worker module
    const { authShareKey } = await import('../worker/pawcards-worker.js')
    const key = await mintShareKey(ROOT, SHARE, FUTURE)
    expect(await authShareKey(key, ROOT, SHARE)).toBe(true)
    expect(await authShareKey(key, ROOT, 'share-other-deck-xx')).toBe(false)
    expect(await authShareKey(await mintShareKey(ROOT, SHARE, PAST), ROOT, SHARE)).toBe(false)
    expect(await authShareKey(await mintTempKey(ROOT, FUTURE), ROOT, SHARE)).toBe(false) // temp key ≠ share key
  })
})

describe('urlWithTempKey', () => {
  it('swaps a root ?key= for a temp key', async () => {
    const url = await urlWithTempKey('https://paw.example.workers.dev/?key=' + ROOT, FUTURE)
    const key = new URL(url).searchParams.get('key')!
    expect(isTempKey(key)).toBe(true)
    expect(await verifyTempKey(key, ROOT)).toBe(true)
  })

  it('leaves an already-temp url unchanged (attendees reshare, never mint)', async () => {
    const tempUrl = await urlWithTempKey('https://paw.example.workers.dev/?key=' + ROOT, FUTURE)
    expect(await urlWithTempKey(tempUrl, Date.now() + 999_999_999)).toBe(tempUrl)
  })

  it('leaves a keyless url unchanged', async () => {
    const url = 'https://paw.example.workers.dev/'
    expect(await urlWithTempKey(url, FUTURE)).toBe(url)
  })
})
