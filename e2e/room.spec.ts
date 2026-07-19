import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import jsQR from 'jsqr'
import { parseRoomQr } from '../src/lib/room'
import { createDeckAndCard, resetApp, store } from './helpers'

const WORKER = 'https://pawroom.test.workers.dev'

/* in-test stand-ins for the worker: KV for share payloads, a fake PawRoom DO */
const kv = new Map<string, string>()
interface Conn {
  ws: WebSocketRoute
  memberId: string
  name: string
}
const room: { meta: { name: string; host: string; createdAt: number } | null; decks: unknown[]; conns: Conn[] } = {
  meta: null,
  decks: [],
  conns: [],
}

function broadcast() {
  const members: { memberId: string; name: string }[] = []
  for (const c of room.conns) if (!members.some((m) => m.memberId === c.memberId)) members.push({ memberId: c.memberId, name: c.name })
  const state = JSON.stringify({ type: 'state', ...(room.meta ?? { name: '?', host: '?', createdAt: 0 }), members, decks: room.decks })
  for (const c of room.conns) c.ws.send(state)
}

async function wire(page: Page) {
  // HTTP: KV get/put for share-… payloads
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
  // WebSocket: the fake room Durable Object
  await page.routeWebSocket(/\/room\//, (ws) => {
    const u = new URL(ws.url())
    const memberId = u.searchParams.get('member') ?? 'anon'
    const name = u.searchParams.get('name') ?? '?'
    if (!room.meta) room.meta = { name: u.searchParams.get('room') ?? 'Room', host: name, createdAt: Date.now() }
    const conn: Conn = { ws, memberId, name }
    room.conns.push(conn)
    ws.onMessage((msg) => {
      const m = JSON.parse(msg as string)
      if (m.type === 'share-deck') {
        const i = room.decks.findIndex((d) => (d as { deckId: string }).deckId === m.meta.deckId)
        if (i >= 0) room.decks[i] = m.meta
        else room.decks.push(m.meta)
        broadcast()
      }
    })
    ws.onClose(() => {
      room.conns = room.conns.filter((c) => c !== conn)
      broadcast()
    })
    broadcast()
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

test('unreachable room (old worker / offline) → clear error, keeps retrying', async ({ page }) => {
  // a worker without the DO answers the upgrade with JSON, i.e. the socket dies
  await page.routeWebSocket(/\/room\//, (ws) => ws.close())
  await resetApp(page, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-room-old', nickname: 'Khaan' })
  await page.getByTestId('room-create').click()
  await page.getByTestId('room-name').fill('Doomed')
  await page.getByTestId('room-create-go').click()
  await expect(page.getByTestId('room-error')).toBeVisible({ timeout: 15_000 })
})

test('room: live create, share, join, import, leave', async ({ browser }) => {
  kv.clear()
  room.meta = null
  room.decks = []
  room.conns = []

  /* ---- host: create room; the socket brings it alive ---- */
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

  await expect(A.getByTestId('room-members')).toContainText('Here: Khaan · hosted by Khaan', { timeout: 5000 })

  /* ---- share a deck into the room (uploads payload + announces pointer) ---- */
  await A.getByTestId('room-share-deck').click()
  const deckId = await store<string>(A, 's => s.decks[0].id')
  await A.getByTestId('pick-deck-' + deckId).click()
  await expect(A.getByTestId('room-deck-' + deckId)).toBeVisible({ timeout: 5000 })
  await expect(A.getByTestId('room-deck-' + deckId)).toContainText('by Khaan')
  expect([...kv.keys()].some((k) => k.startsWith('share-'))).toBe(true)

  /* ---- invite QR decodes to the room pointer ---- */
  await A.getByTestId('room-invite').click()
  const invite = parseRoomQr(await decodeCanvas(A, 'room-qr-canvas'))
  expect(invite.name).toBe('Thai Cooking')
  expect(invite.url).toBe(WORKER + '/?key=pw')
  await A.getByText('Close').click()

  /* ---- friend joins: presence pushes to BOTH devices instantly ---- */
  const B = await (await browser.newContext()).newPage()
  await wire(B)
  await resetApp(B, { nickname: 'Fai' })
  await B.evaluate((invite) => {
    const w = window as any
    w.__store.getState().addRoomRef({ code: invite.code, url: invite.url, name: invite.name, memberId: 'friend01', joinedAt: Date.now() })
    w.__store.getState().openRoom(invite.code)
  }, invite)

  await expect(B.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })
  await expect(B.getByTestId('room-members')).toContainText('Fai')
  await expect(A.getByTestId('room-members')).toContainText('Fai', { timeout: 5000 }) // ← pushed, not polled

  /* ---- import on B ---- */
  await expect(B.getByTestId('room-deck-' + deckId)).toBeVisible()
  await B.getByTestId('room-import-' + deckId).click()
  await expect(B.locator('#toast')).toContainText('Imported', { timeout: 5000 })
  expect(await store<string>(B, 's => s.decks[0].sharedBy')).toBe('Khaan')
  expect(await store<number>(B, 's => s.cards.length')).toBe(1)
  await expect(B.getByTestId('room-deck-' + deckId)).toContainText('In library')

  /* ---- B leaves: chip gone, deck stays, A sees B disappear ---- */
  await B.getByText('‹').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toBeVisible()
  await B.getByTestId('room-chip-' + invite.code).click()
  await expect(B.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })
  await B.getByText('Leave room').click()
  await B.getByText('Tap again to leave').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toHaveCount(0)
  expect(await store<number>(B, 's => s.decks.length')).toBe(1)
  await expect(A.getByTestId('room-members')).not.toContainText('Fai', { timeout: 5000 })
})
