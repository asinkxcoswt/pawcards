import { expect, test, type Page, type WebSocketRoute } from '@playwright/test'
import jsQR from 'jsqr'
import { parseInvite } from '../src/lib/invite'
import { createDeckAndCard, resetApp, store } from './helpers'

const WORKER = 'https://pawroom.test.workers.dev'

/* in-test stand-ins for the worker: KV for share payloads, a fake PawRoom DO */
const kv = new Map<string, string>()
interface Conn {
  ws: WebSocketRoute
  memberId: string
  name: string
}
interface FakeReview {
  queue: { deckId: string; cardId: string }[]
  i: number
  flipped: boolean
  hostMemberId: string
  hostName: string
  startedAt: number
}
const room: {
  meta: { name: string; host: string; createdAt: number } | null
  decks: unknown[]
  conns: Conn[]
  review: FakeReview | null
} = { meta: null, decks: [], conns: [], review: null }

function broadcast() {
  const members: { memberId: string; name: string }[] = []
  for (const c of room.conns) if (!members.some((m) => m.memberId === c.memberId)) members.push({ memberId: c.memberId, name: c.name })
  const state = JSON.stringify({
    type: 'state',
    proto: 2,
    ...(room.meta ?? { name: '?', host: '?', createdAt: 0 }),
    members,
    decks: room.decks,
    review: room.review,
  })
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
      type Meta = { deckId: string; memberId?: string }
      if (m.type === 'share-deck') {
        const meta = { ...m.meta, memberId } // DO stamps the sharer
        const i = room.decks.findIndex((d) => (d as Meta).deckId === meta.deckId)
        if (i >= 0) {
          if ((room.decks[i] as Meta).memberId !== memberId) return
          room.decks[i] = meta
        } else room.decks.push(meta)
        broadcast()
      }
      if (m.type === 'remove-deck') {
        const entry = room.decks.find((d) => (d as Meta).deckId === m.deckId)
        if (!entry || (entry as Meta).memberId !== memberId) return
        room.decks = room.decks.filter((d) => d !== entry)
        broadcast()
      }
      // group review — mirrors the PawRoom DO
      if (m.type === 'start-review' && Array.isArray(m.queue) && m.queue.length) {
        room.review = { queue: m.queue, i: 0, flipped: false, hostMemberId: memberId, hostName: name, startedAt: 1 }
        broadcast()
      }
      if (m.type === 'review-flip' || m.type === 'review-next' || m.type === 'review-end') {
        if (!room.review || room.review.hostMemberId !== memberId) return
        if (m.type === 'review-flip') room.review.flipped = true
        else if (m.type === 'review-next' && room.review.i + 1 < room.review.queue.length) {
          room.review.i += 1
          room.review.flipped = false
        } else room.review = null
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

test('stale worker (no proto in state) → visible warning instead of silent failure', async ({ page }) => {
  // a pre-group-review DO broadcasts state without `proto`
  await page.routeWebSocket(/\/room\//, (ws) => {
    ws.send(JSON.stringify({ type: 'state', name: 'Old Room', host: 'Khaan', createdAt: 1, members: [], decks: [] }))
  })
  await resetApp(page, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-room-proto', nickname: 'Khaan' })
  await page.evaluate(() => {
    const w = window as any
    w.__store.getState().addRoomRef({ code: 'room-old-proto', url: 'https://pawroom.test.workers.dev/?key=pw', name: 'Old Room', memberId: 'm1', joinedAt: Date.now() })
    w.__store.getState().openRoom('room-old-proto')
  })
  await expect(page.getByTestId('room-proto-warning')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('room-proto-warning')).toContainText('redeploys')
})

test('group review: host drives, guest follows live, grading imports implicitly', async ({ browser }) => {
  kv.clear()
  Object.assign(room, { meta: null, decks: [], conns: [], review: null })

  /* host: deck with 2 cards, room, share the deck in */
  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-rr-1', nickname: 'Khaan' })
  await createDeckAndCard(A, 'Herbs', 'basil vs holy basil')
  await A.getByTestId('back').click()
  const deckId = await store<string>(A, 's => s.decks[0].id')
  await A.evaluate((deckId) => {
    const w = window as any
    const t = Date.now()
    w.__store.setState({
      cards: [
        ...w.__store.getState().cards,
        { id: 'c2', deckId, created: t, updated: t, front: [], back: [], backText: 'galangal is not ginger', srs: null, polished: {} },
      ],
    })
  }, deckId)
  await A.getByTestId('back').click() // → home
  await A.getByTestId('room-create').click()
  await A.getByTestId('room-name').fill('Thai Cooking')
  await A.getByTestId('room-create-go').click()
  await A.getByTestId('room-share-deck').click()
  await A.getByTestId('pick-deck-' + deckId).click()
  await expect(A.getByTestId('room-deck-' + deckId)).toContainText('2 cards', { timeout: 5000 })

  /* guest joins, does NOT import */
  const B = await (await browser.newContext()).newPage()
  await wire(B)
  await resetApp(B, { nickname: 'Fai' })
  await B.evaluate(() => {
    const w = window as any
    w.__store.getState().addRoomRef({ code: 'room-rr-test', url: 'https://pawroom.test.workers.dev/?key=pw', name: 'Thai Cooking', memberId: 'friend01', joinedAt: Date.now() })
    w.__store.getState().openRoom('room-rr-test')
  })
  await expect(B.getByTestId('room-members')).toContainText('Fai', { timeout: 5000 })

  /* host starts (dialog → default All of the 2 shared cards); guest sees the banner and joins */
  await A.getByTestId('room-review-start').click()
  await A.getByTestId('rr-start-go').click()
  await expect(A.getByTestId('rr-card')).toBeVisible({ timeout: 5000 })
  await expect(B.getByTestId('room-review-join')).toBeVisible({ timeout: 5000 })
  await B.getByTestId('room-review-join').click()
  await expect(B.getByTestId('rr-card')).toBeVisible()
  await expect(A.getByTestId('rr-progress')).toHaveText('1 / 2')
  await expect(B.getByTestId('rr-progress')).toHaveText('1 / 2')

  /* host reveals — the guest's card flips by itself, same answer */
  await expect(B.getByTestId('rr-answer')).toHaveCount(0)
  await A.getByTestId('rr-flip').click()
  await expect(B.getByTestId('rr-answer')).toBeVisible({ timeout: 5000 })
  const answerA = await A.getByTestId('rr-answer').textContent()
  const answerB = await B.getByTestId('rr-answer').textContent()
  expect(answerB).toBe(answerA)

  /* guest grades Good → implicit import + private SRS */
  await B.getByTestId('rr-grade-2').click()
  await expect(B.locator('#toast')).toContainText('Imported', { timeout: 5000 })
  expect(await store<number>(B, 's => s.decks.length')).toBe(1)
  expect(await store<string>(B, 's => s.decks[0].sharedBy')).toBe('Khaan')
  expect(await store<boolean>(B, 's => s.cards.some(c => c.srs && c.srs.reps === 1)')).toBe(true)
  // host's own copy is untouched by the guest's grade
  expect(await store<boolean>(A, 's => s.cards.every(c => !c.srs)')).toBe(true)

  /* host advances; both move together */
  await A.getByTestId('rr-next').click()
  await expect(A.getByTestId('rr-progress')).toHaveText('2 / 2')
  await expect(B.getByTestId('rr-progress')).toHaveText('2 / 2', { timeout: 5000 })

  /* finishing returns everyone to the room */
  await A.getByTestId('rr-flip').click()
  await A.getByTestId('rr-next').click() // 🏁 Finish
  await expect(A.getByTestId('rr-card')).toHaveCount(0, { timeout: 5000 })
  await expect(B.getByTestId('rr-card')).toHaveCount(0, { timeout: 5000 })
  await expect(B.locator('#toast')).toContainText('finished')
})

test('group review: host picks a card count, app draws that many at random', async ({ browser }) => {
  kv.clear()
  Object.assign(room, { meta: null, decks: [], conns: [], review: null })

  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-rr-2', nickname: 'Khaan' })
  await createDeckAndCard(A, 'Herbs', 'c1')
  await A.getByTestId('back').click()
  const deckId = await store<string>(A, 's => s.decks[0].id')
  // grow the deck to 4 cards
  await A.evaluate((deckId) => {
    const w = window as any
    const t = Date.now()
    const extra = ['c2', 'c3', 'c4'].map((id) => ({ id, deckId, created: t, updated: t, front: [], back: [], backText: id, srs: null, polished: {} }))
    w.__store.setState({ cards: [...w.__store.getState().cards, ...extra] })
  }, deckId)
  await A.getByTestId('back').click()
  await A.getByTestId('room-create').click()
  await A.getByTestId('room-name').fill('Herb Quiz')
  await A.getByTestId('room-create-go').click()
  await A.getByTestId('room-share-deck').click()
  await A.getByTestId('pick-deck-' + deckId).click()
  await expect(A.getByTestId('room-deck-' + deckId)).toContainText('4 cards', { timeout: 5000 })

  // host asks for just 2 of the 4 shared cards (default is 4 → step down twice)
  await A.getByTestId('room-review-start').click()
  await expect(A.getByTestId('rr-count-value')).toHaveText('4')
  await A.getByTestId('rr-count-dec').click()
  await A.getByTestId('rr-count-dec').click()
  await expect(A.getByTestId('rr-count-value')).toHaveText('2')
  await A.getByTestId('rr-start-go').click()
  await expect(A.getByTestId('rr-progress')).toHaveText('1 / 2', { timeout: 5000 })
  // the choice is remembered for next time
  expect(await store<number>(A, 's => s.settings.roomReviewCount')).toBe(2)
})

test('room: live create, share, join, import, leave', async ({ browser }) => {
  kv.clear()
  room.meta = null
  room.decks = []
  room.conns = []
  room.review = null

  /* ---- host: create room; the socket brings it alive ---- */
  const A = await (await browser.newContext()).newPage()
  await wire(A)
  await resetApp(A, { syncUrl: WORKER + '/?key=pw', syncId: 'paw-e2e-room-1' })
  await createDeckAndCard(A, 'Herbs', 'basil vs holy basil')
  await A.getByTestId('back').click() // → deck view
  await A.getByTestId('back').click() // → home

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
  const invite = parseInvite(await decodeCanvas(A, 'room-qr-canvas'))
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
  await expect(B.getByTestId('room-deck-' + deckId)).toContainText('Update')

  /* ---- A edits the deck and re-shares; B sees the new count and updates ---- */
  await A.evaluate((deckId) => {
    const w = window as any
    const t = Date.now()
    w.__store.setState({
      cards: [
        ...w.__store.getState().cards,
        { id: 'c-new', deckId, created: t, updated: t, front: [], back: [], backText: 'lemongrass', srs: null, polished: {} },
      ],
    })
  }, deckId)
  await A.getByTestId('room-reshare-' + deckId).click()
  await expect(B.getByTestId('room-deck-' + deckId)).toContainText('2 cards', { timeout: 5000 }) // pushed live
  await B.getByTestId('room-update-' + deckId).click()
  await expect(B.locator('#toast')).toContainText('updated', { timeout: 5000 })
  expect(await store<number>(B, 's => s.cards.length')).toBe(2)

  /* ---- A unshares: the row vanishes for B, but B's imported copy stays ---- */
  await A.getByTestId('room-unshare-' + deckId).click()
  await A.getByTestId('room-unshare-' + deckId).click()
  await expect(B.getByTestId('room-deck-' + deckId)).toHaveCount(0, { timeout: 5000 })
  expect(await store<number>(B, 's => s.cards.length')).toBe(2)

  /* ---- B leaves: chip gone, deck stays, A sees B disappear ---- */
  await B.getByTestId('back').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toBeVisible()
  await B.getByTestId('room-chip-' + invite.code).click()
  await expect(B.getByTestId('room-members')).toContainText('Khaan', { timeout: 5000 })
  await B.getByText('Leave room').click()
  await B.getByText('Tap again to leave').click()
  await expect(B.getByTestId('room-chip-' + invite.code)).toHaveCount(0)
  expect(await store<number>(B, 's => s.decks.length')).toBe(1)
  await expect(A.getByTestId('room-members')).not.toContainText('Fai', { timeout: 5000 })
})
