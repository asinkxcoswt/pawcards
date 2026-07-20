import { expect, test, type Page } from '@playwright/test'
import { resetApp, store } from './helpers'

/**
 * Image blob store (v3.11): card images live OUTSIDE the sync doc as
 * /img blobs; the doc carries only `img:<id>` refs. These tests simulate
 * the worker's /sync + /img endpoints with an in-test KV.
 */

const WORKER = 'https://pawblob.test.workers.dev'

// 1×1 red PNG — stands in for a generated card image
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let storedDoc: string | null = null
let blobs: Map<string, Buffer> = new Map()
let blobGets = 0
let failUploads = false

async function wire(page: Page) {
  await page.route(WORKER + '/**', (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname === '/img') {
      const imgId = url.searchParams.get('img')!
      if (req.method() === 'PUT') {
        if (failUploads) {
          route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"kaput"}' })
          return
        }
        blobs.set(imgId, req.postDataBuffer()!)
        route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      } else if (req.method() === 'GET') {
        const b = blobs.get(imgId)
        blobGets++
        if (!b) route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' })
        else route.fulfill({ status: 200, contentType: 'image/webp', body: b })
      } else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
      return
    }
    if (url.pathname === '/img-gc') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"removed":0,"kept":0}' })
      return
    }
    if (url.pathname !== '/sync') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"images":["QUJD"]}' })
      return
    }
    if (req.method() === 'GET') {
      if (!storedDoc) route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' })
      else route.fulfill({ status: 200, contentType: 'application/json', body: storedDoc })
    } else {
      storedDoc = JSON.stringify({ doc: JSON.parse(req.postData()!).doc, updatedAt: 1 })
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"updatedAt":1}' })
    }
  })
}

async function device(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await wire(page)
  await resetApp(page, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-blob-01' })
  return page
}

function seedImageCard(page: Page, dataUrl: string) {
  return page.evaluate((img) => {
    ;(window as any).__store.setState({
      decks: [{ id: 'deck1', name: 'Art', color: '#e0663c', created: 1000 }],
      cards: [
        {
          id: 'c1',
          deckId: 'deck1',
          created: 1000,
          updated: 1000,
          front: [],
          back: [],
          backText: 'a red dot',
          srs: null,
          polished: { front: img },
        },
      ],
    })
  }, dataUrl)
}

test('sync moves the image to the blob store; the doc carries only the ref', async ({ browser }) => {
  storedDoc = null
  blobs = new Map()
  const A = await device(browser)
  await seedImageCard(A, TINY_PNG)
  await A.evaluate(() => (window as any).__store.getState().syncNow(false))
  await expect(A.locator('#toast')).toContainText('Synced')

  // the card was rewritten to an img: ref and the pushed doc holds no data URL
  const ref = await store<string>(A, "s => s.cards.find(c => c.id === 'c1').polished.front")
  expect(ref).toMatch(/^img:/)
  expect(storedDoc).not.toContain('data:image')
  expect(storedDoc).toContain(ref)
  expect(blobs.size).toBe(1)
})

test('second device pulls the ref and lazily fetches the blob to paint the thumbnail', async ({ browser }) => {
  // storedDoc/blobs carry over from the previous test's push
  expect(storedDoc).not.toBeNull()
  blobGets = 0
  const B = await device(browser)
  await B.evaluate(() => (window as any).__store.getState().syncNow(false))
  await expect(B.locator('#toast')).toContainText('Synced')
  expect(await store<string>(B, "s => s.cards.find(c => c.id === 'c1').polished.front")).toMatch(/^img:/)

  // opening the deck paints the thumbnail → exactly one blob download
  await B.getByText('Art').click()
  await expect.poll(() => blobGets).toBe(1)

  // re-render does not refetch (memory/IndexedDB cache)
  await B.evaluate(() => (window as any).__store.getState().go('home'))
  await B.evaluate(() => (window as any).__store.getState().openDeck('deck1'))
  await B.waitForTimeout(300)
  expect(blobGets).toBe(1)
})

test('upload failure falls back to pushing the data URL (nothing lost)', async ({ browser }) => {
  storedDoc = null
  blobs = new Map()
  failUploads = true
  const A = await device(browser)
  await seedImageCard(A, TINY_PNG)
  await A.evaluate(() => (window as any).__store.getState().syncNow(false))
  await expect(A.locator('#toast')).toContainText('Synced')

  // card keeps its data URL locally and the pushed doc still carries it inline
  expect(await store<string>(A, "s => s.cards.find(c => c.id === 'c1').polished.front")).toContain('data:image')
  expect(storedDoc).toContain('data:image')
  failUploads = false
})
