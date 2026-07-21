import { expect, test, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { deckShareLink, parseShareQr, type ShareDoc } from '../src/lib/share'
import { createDeckAndCard, resetApp, store } from './helpers'

const WORKER = 'https://pawshare.test.workers.dev'

// in-test KV shared by both simulated devices
const kv = new Map<string, string>()

async function wire(page: Page) {
  await page.route(WORKER + '/**', (route) => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.pathname !== '/sync') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    const id = u.searchParams.get('id') ?? ''
    if (req.method() === 'GET') {
      const v = kv.get(id)
      if (!v) route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' })
      else route.fulfill({ status: 200, contentType: 'application/json', body: v })
      return
    }
    kv.set(id, JSON.stringify({ doc: JSON.parse(req.postData()!).doc, updatedAt: 1 }))
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"updatedAt":1}' })
  })
}

async function decodeCanvas(page: Page, testId: string) {
  const canvas = page.getByTestId(testId)
  await expect(canvas).toBeVisible()
  const img = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { data: Array.from(d.data), width: d.width, height: d.height }
  })
  const code = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)
  expect(code).not.toBeNull()
  return code!.data
}

test('share a deck via QR; a friend imports it with the 🤝 tag', async ({ browser }) => {
  kv.clear()

  /* ---- device A: create + share ---- */
  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-share-1' })
  await createDeckAndCard(A, 'Thai Cooking', 'pad krapow needs holy basil')
  await A.getByTestId('back').click() // editor → deck view

  await A.getByTestId('share-deck').click()
  await A.getByTestId('share-nickname').fill('Khaan')
  await A.getByTestId('share-upload').click()

  // the QR decodes to a pointer at the uploaded share
  const qr = parseShareQr(await decodeCanvas(A, 'share-qr-canvas'))
  expect(qr.name).toBe('Thai Cooking')
  expect(qr.by).toBe('Khaan')
  expect(qr.count).toBe(1)
  // the recipient url carries a SCOPED read-only token, never the root key
  const shareUrl = new URL(qr.url)
  expect(shareUrl.origin).toBe(WORKER)
  expect(shareUrl.searchParams.get('key')).toMatch(/^ps_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  expect(qr.url).not.toContain('key=pw')

  // the deck (with cards) actually landed in KV under that id
  const stored = JSON.parse(kv.get(qr.id)!).doc as ShareDoc
  expect(stored.deck.name).toBe('Thai Cooking')
  expect(stored.cards).toHaveLength(1)
  expect(stored.by).toBe('Khaan')

  // nickname is remembered for next time
  expect(await store<string>(A, 's => s.settings.nickname')).toBe('Khaan')

  /* ---- device B: import (post-scan path, driven via the store) ---- */
  const B = await (await browser.newContext()).newPage()
  await wire(B)
  await resetApp(B)
  await B.evaluate((doc) => {
    ;(window as any).__store.getState().importSharedDeck(doc)
  }, stored)

  expect(await store<number>(B, 's => s.decks.length')).toBe(1)
  expect(await store<string>(B, 's => s.decks[0].sharedBy')).toBe('Khaan')
  expect(await store<number>(B, 's => s.cards.length')).toBe(1)
  // the home grid shows who shared it
  await expect(B.getByText('Khaan')).toBeVisible()

  // re-import is idempotent and never duplicates
  await B.evaluate((doc) => {
    ;(window as any).__store.getState().importSharedDeck(doc)
  }, stored)
  expect(await store<number>(B, 's => s.cards.length')).toBe(1)
})

test('deck-share LINK: a fresh user saves the deck, settings untouched', async ({ browser }) => {
  kv.clear()
  // a deck sits in the sharer's KV (as uploadDeckShare would leave it)
  const shareId = 'share-link-test-01'
  const shareDoc = {
    deck: { id: 'dl1', name: 'Kanji N5', color: '#eee', created: 1 },
    cards: [{ id: 'kc1', deckId: 'dl1', created: 1, updated: 1, front: [], back: [], backText: 'water = 水', srs: null, polished: {} }],
    by: 'Nong',
    at: 1,
  }
  kv.set(shareId, JSON.stringify({ doc: shareDoc, updatedAt: 1 }))
  const qr = { url: WORKER + '/?key=pw', id: shareId, name: 'Kanji N5', by: 'Nong', count: 1 }
  const u = new URL(deckShareLink('https://example.test', qr))
  const link = u.pathname + u.search + u.hash

  // a BRAND-NEW device opens the link
  const B = await (await browser.newContext()).newPage()
  await wire(B)
  await B.goto(link)
  await B.waitForFunction('window.__store && window.__store.getState().loaded')

  // the deck-share popup appears (not onboarding), and saves on tap
  await expect(B.getByTestId('deck-share-gate')).toBeVisible()
  await expect(B.locator('[data-testid="onboarding"]')).toHaveCount(0)
  await B.getByTestId('deck-share-save').click()

  // the shared deck is added (alongside the bundled Example Deck a new user gets)
  expect(await store<boolean>(B, "s => s.decks.some(d => d.name === 'Kanji N5')")).toBe(true)
  expect(await store<boolean>(B, "s => s.cards.some(c => c.backText === 'water = 水')")).toBe(true)
  // settings were NEVER auto-configured — this is the deck-link contract
  expect(await store<string>(B, 's => s.settings.syncUrl')).toBe('')
  expect(await store<string>(B, 's => s.settings.apiKey')).toBe('')
})

test('selection mode marks a card private; it is left out of the share', async ({ browser }) => {
  kv.clear()
  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-share-2', nickname: 'Khaan' })
  await createDeckAndCard(A, 'Notes', 'public fact')
  await A.getByTestId('back').click() // → deck view
  const deckId = await store<string>(A, 's => s.decks[0].id')
  // add a second card that we'll keep private
  await A.evaluate((deckId) => {
    const w = window as any
    const t = Date.now()
    w.__store.setState({
      cards: [...w.__store.getState().cards, { id: 'secret', deckId, created: t, updated: t, front: [], back: [], backText: 'my private note', srs: null, polished: {} }],
    })
  }, deckId)

  // enter selection mode, lock the secret card, leave
  await A.getByTestId('select-mode').click()
  await A.getByTestId('select-card-secret').click()
  await expect(A.getByTestId('private-badge-secret')).toBeVisible()
  await A.getByTestId('select-done').click()
  // the flag persisted with a touch (sync-safe)
  expect(await store<boolean>(A, "s => !!s.cards.find(c => c.id === 'secret').private")).toBe(true)
  expect(await store<boolean>(A, "s => !!s.cards.find(c => c.id === 'secret').updated")).toBe(true)

  // share — the modal reports 1 of 2, and only the public card lands in KV
  await A.getByTestId('share-deck').click()
  await expect(A.locator('.hint')).toContainText('1 kept private')
  const qr = parseShareQr(await decodeCanvas(A, 'share-qr-canvas'))
  expect(qr.count).toBe(1)
  const stored = JSON.parse(kv.get(qr.id)!).doc as ShareDoc
  expect(stored.cards.map((c) => c.id)).toEqual([await store<string>(A, "s => s.cards.find(c => !c.private).id")])
  expect(stored.cards.some((c) => c.id === 'secret')).toBe(false)
})
