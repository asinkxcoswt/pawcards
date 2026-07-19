import { expect, test, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { parseRoomQr } from '../src/lib/room'
import { createDeckAndCard, resetApp, store } from './helpers'

const WORKER = 'https://pawroom.test.workers.dev'

// in-test KV with ?list= support, shared by all simulated devices
const kv = new Map<string, string>()

async function wire(page: Page) {
  await page.route(WORKER + '/**', (route) => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.pathname !== '/sync') {
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return
    }
    const list = u.searchParams.get('list')
    if (req.method() === 'GET' && list) {
      const ids = [...kv.keys()].filter((k) => k.startsWith(list))
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ids }) })
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

test('room: create, share a deck in, friend joins + imports, revisit and leave', async ({ browser }) => {
  kv.clear()

  /* ---- host: create room and share a deck into it ---- */
  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-room-1' })
  await createDeckAndCard(A, 'Herbs', 'basil vs holy basil')
  await A.getByText('‹').click() // → deck view
  await A.getByText('‹').click() // → home

  await A.getByTestId('room-create').click()
  await A.getByTestId('room-name').fill('Thai Cooking')
  await A.getByTestId('room-nickname').fill('Khaan')
  await A.getByTestId('room-create-go').click()

  // in the room; host is listed as a member
  await expect(A.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })

  // share the deck into the room
  await A.getByTestId('room-share-deck').click()
  const deckId = await store<string>(A, 's => s.decks[0].id')
  await A.getByTestId('pick-deck-' + deckId).click()
  await expect(A.getByTestId('room-deck-' + deckId)).toBeVisible({ timeout: 5000 })
  await expect(A.getByTestId('room-deck-' + deckId)).toContainText('by Khaan')

  // invite QR decodes to the room pointer
  await A.getByTestId('room-invite').click()
  const invite = parseRoomQr(await decodeCanvas(A, 'room-qr-canvas'))
  expect(invite.name).toBe('Thai Cooking')
  expect(invite.url).toBe(WORKER + '/?key=pw')

  /* ---- friend: join (post-scan path via store-level join), browse, import ---- */
  const B = await (await browser.newContext()).newPage()
  await wire(B)
  await resetApp(B)
  // the same steps JoinRoomModal performs after a successful scan (camera can't run in e2e)
  await B.evaluate(
    async ({ invite }) => {
      const w = window as any
      const u = new URL(invite.url)
      const ep =
        u.origin +
        '/sync?key=' +
        encodeURIComponent(u.searchParams.get('key') ?? '') +
        '&id=' +
        encodeURIComponent(invite.code + '-member-friend01')
      await fetch(ep, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doc: { name: 'Fai', at: Date.now() } }),
      })
      w.__store.getState().saveSettings({ nickname: 'Fai' })
      w.__store.getState().addRoomRef({ code: invite.code, url: invite.url, name: invite.name, memberId: 'friend01', joinedAt: Date.now() })
      w.__store.getState().openRoom(invite.code)
    },
    { invite },
  )

  // sees both members and the shared deck
  await expect(B.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })
  await expect(B.getByTestId('room-members')).toContainText('Fai')
  await expect(B.getByTestId('room-deck-' + deckId)).toBeVisible()

  await B.getByTestId('room-import-' + deckId).click()
  await expect(B.locator('#toast')).toContainText('Imported', { timeout: 5000 })
  expect(await store<string>(B, 's => s.decks[0].sharedBy')).toBe('Khaan')
  expect(await store<number>(B, 's => s.cards.length')).toBe(1)
  await expect(B.getByTestId('room-deck-' + deckId)).toContainText('In library')

  // the room appears on Home and can be revisited
  await B.getByText('‹').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toBeVisible()
  await B.getByTestId('room-chip-' + invite.code).click()
  await expect(B.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })

  // leaving removes the chip but keeps the imported deck
  await B.getByText('Leave room').click()
  await B.getByText('Tap again to leave').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toHaveCount(0)
  expect(await store<number>(B, 's => s.decks.length')).toBe(1)
  expect(await store<number>(B, "s => s.rooms.length")).toBe(0)
})
