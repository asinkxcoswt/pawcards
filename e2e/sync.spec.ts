import { expect, test, type Page } from '@playwright/test'
import { resetApp, store } from './helpers'

const WORKER = 'https://pawsync.test.workers.dev'

// a tiny in-test KV: one stored doc shared by both simulated devices
let stored: string | null = null

async function wire(page: Page) {
  await page.route(WORKER + '/**', (route) => {
    const req = route.request()
    if (new URL(req.url()).pathname !== '/sync') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"images":["QUJD"]}' })
      return
    }
    if (req.method() === 'GET') {
      if (!stored) route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' })
      else route.fulfill({ status: 200, contentType: 'application/json', body: stored })
    } else {
      stored = JSON.stringify({ doc: JSON.parse(req.postData()!).doc, updatedAt: 1 })
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"updatedAt":1}' })
    }
  })
}

async function device(browser: import('@playwright/test').Browser) {
  const ctx = await browser.newContext() // isolated storage = separate device
  const page = await ctx.newPage()
  await wire(page)
  await resetApp(page, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-sync-01' })
  return page
}

test('two devices converge: merge, edit-wins, tombstoned delete, grade sync', async ({ browser }) => {
  stored = null
  const A = await device(browser)

  // A creates a deck + 2 cards and pushes
  await A.evaluate(() => {
    const s = (window as any).__store.getState()
    ;(window as any).__store.setState({
      decks: [{ id: 'deck1', name: 'Bio', color: '#e0663c', created: 1000 }],
      cards: [
        { id: 'c1', deckId: 'deck1', created: 1000, updated: 1000, front: [], back: [], backText: 'one', srs: null, polished: {} },
        { id: 'c2', deckId: 'deck1', created: 1001, updated: 1001, front: [], back: [], backText: 'two', srs: null, polished: {} },
      ],
    })
    return s.syncNow(false)
  })
  await expect(A.locator('#toast')).toContainText('Synced')

  // B starts empty and pulls everything
  const B = await device(browser)
  await B.evaluate(() => (window as any).__store.getState().syncNow(false))
  await expect(B.locator('#toast')).toContainText('Synced')
  expect(await store<number>(B, 's => s.cards.length')).toBe(2)

  // B edits c1 (newer) and deletes c2, then pushes
  await B.evaluate(() => {
    const w = (window as any).__store
    const s = w.getState()
    w.setState({
      cards: s.cards
        .filter((c: any) => c.id !== 'c2')
        .map((c: any) => (c.id === 'c1' ? { ...c, backText: 'one EDITED ON B', updated: Date.now() } : c)),
      tombstones: { ...s.tombstones, c2: Date.now() },
    })
    return w.getState().syncNow(false)
  })
  await expect(B.locator('#toast')).toContainText('Synced')

  // A adds c3, then syncs → gets B's edit, loses c2, keeps c3
  await A.evaluate(() => {
    const w = (window as any).__store
    const s = w.getState()
    w.setState({
      cards: [
        ...s.cards,
        { id: 'c3', deckId: 'deck1', created: Date.now(), updated: Date.now(), front: [], back: [], backText: 'three', srs: null, polished: {} },
      ],
    })
    return w.getState().syncNow(false)
  })
  await expect(A.locator('#toast')).toContainText('Synced')
  expect(await store<string>(A, "s => s.cards.find(c => c.id === 'c1').backText")).toBe('one EDITED ON B')
  expect(await store<boolean>(A, "s => !s.cards.some(c => c.id === 'c2')")).toBe(true)
  expect(await store<boolean>(A, "s => s.cards.some(c => c.id === 'c3')")).toBe(true)

  // B pulls again → gets c3; c2 stays dead; review grades travel too
  await A.evaluate(() => {
    const w = (window as any).__store
    const s = w.getState()
    w.setState({
      cards: s.cards.map((c: any) =>
        c.id === 'c1' ? { ...c, srs: { ease: 2.5, interval: 86400000, reps: 1, lapses: 0, due: Date.now() + 86400000 }, updated: Date.now() } : c,
      ),
    })
    return w.getState().syncNow(false)
  })
  await expect(A.locator('#toast')).toContainText('Synced')
  await B.evaluate(() => (window as any).__store.getState().syncNow(false))
  await expect(B.locator('#toast')).toContainText('Synced')
  expect(await store<boolean>(B, "s => s.cards.some(c => c.id === 'c3')")).toBe(true)
  expect(await store<boolean>(B, "s => !s.cards.some(c => c.id === 'c2')")).toBe(true)
  expect(await store<number>(B, "s => s.cards.find(c => c.id === 'c1').srs.reps")).toBe(1)
})

test('sync button shows loading state and updates status line', async ({ browser }) => {
  stored = null
  const page = await device(browser)
  // slow the network so the loading state is observable
  await page.unroute(WORKER + '/**')
  await page.route(WORKER + '/**', async (route) => {
    await new Promise((r) => setTimeout(r, 600))
    if (route.request().method() === 'GET')
      route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"none"}' })
    else route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"updatedAt":1}' })
  })
  await page.locator('.iconbtn', { hasText: '⚙︎' }).click()
  await page.getByTestId('sync-now').click()
  await expect(page.getByTestId('sync-now')).toContainText('Syncing…')
  await expect(page.getByTestId('sync-now')).toBeDisabled()
  await expect(page.getByTestId('sync-now')).toContainText('Sync now', { timeout: 5000 })
  await expect(page.getByTestId('sync-status')).toContainText('Last synced')
})
