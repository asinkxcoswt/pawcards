import { describe, expect, it } from 'bun:test'
import { isTempKey, mintTempKey, tempKeyExp, urlWithTempKey, verifyTempKey } from '../src/lib/tempkey'

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

describe('worker authKey (mirror cross-check)', () => {
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
