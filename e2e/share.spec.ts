import { expect, test, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { parseShareQr, type ShareDoc } from '../src/lib/share'
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
  await A.getByText('‹').click() // editor → deck view

  await A.getByTestId('share-deck').click()
  await A.getByTestId('share-nickname').fill('Khaan')
  await A.getByTestId('share-upload').click()

  // the QR decodes to a pointer at the uploaded share
  const qr = parseShareQr(await decodeCanvas(A, 'share-qr-canvas'))
  expect(qr.name).toBe('Thai Cooking')
  expect(qr.by).toBe('Khaan')
  expect(qr.count).toBe(1)
  expect(qr.url).toBe(WORKER + '/?key=pw')

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
  await expect(B.getByText('🤝 Khaan')).toBeVisible()

  // re-import is idempotent and never duplicates
  await B.evaluate((doc) => {
    ;(window as any).__store.getState().importSharedDeck(doc)
  }, stored)
  expect(await store<number>(B, 's => s.cards.length')).toBe(1)
})
