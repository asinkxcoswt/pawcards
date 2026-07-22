import { expect, test } from '@playwright/test'
import { createDeckAndCard, drawLine, resetApp, store } from './helpers'

test('deck → card → draw → review → Easy retires → shuffle rescue', async ({ page }) => {
  await resetApp(page)

  // deck creation via modal (Enter submits)
  await page.getByTestId('new-deck').click()
  await page.getByPlaceholder('Deck name').fill('Biology')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Biology' })).toBeVisible()

  // new card opens the editor with the answer box focused
  await page.getByTestId('new-card').click()
  await expect(page.getByPlaceholder(/key takeaway/)).toBeFocused()
  await page.getByPlaceholder(/key takeaway/).fill('Mitochondria is the powerhouse of the cell')

  // draw on the front
  await drawLine(page, 40, 40, 160, 100)
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(1)

  // undo / redo
  await page.getByTitle('Undo').click()
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(0)
  await page.getByTitle('Redo').click()
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(1)

  // back to deck; card is due
  await page.locator('.iconbtn').first().click()
  await expect(page.getByText('Review (1)')).toBeVisible()

  // review: flip, answer text is DOM, grade Easy → retired
  await page.getByText('Review (1)').click()
  await page.getByTestId('review-card').click()
  await expect(page.getByTestId('review-answer')).toContainText('Mitochondria')
  await expect(page.getByText('✓ done')).toBeVisible()
  await page.getByRole('button', { name: /Easy/ }).click()
  await expect(page.getByText(/Session complete/)).toBeVisible()
  expect(await store<boolean>(page, 's => s.cards[0].srs.retired === true')).toBe(true)

  // retired card: nothing due, tile shows done
  expect(await store<number>(page, "s => s.cards.filter(c => !c.srs || (!c.srs.retired && c.srs.due <= Date.now())).length")).toBe(0)

  // review-all rescue: Again on the retired card un-retires it. Nothing is due,
  // so the button is "Review all" → opens the count/order dialog.
  await page.getByText('Biology').click()
  await page.getByTestId('review-all').click()
  await page.getByTestId('ra-start').click()
  await page.getByTestId('review-card').click()
  await page.getByRole('button', { name: /Again/ }).click()
  expect(await store<boolean>(page, 's => s.cards[0].srs.retired === false')).toBe(true)
})

test('empty card is discarded (and tombstoned) on close', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'X', '')
  await page.locator('.iconbtn').first().click() // close editor without content
  expect(await store<number>(page, 's => s.cards.length')).toBe(0)
  expect(await store<number>(page, 's => Object.keys(s.tombstones).length')).toBe(1)
})

test('data persists across reload (IndexedDB)', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'Persist', 'the answer')
  await page.waitForTimeout(700) // debounced save
  await page.reload()
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  expect(await store<number>(page, 's => s.decks.length')).toBe(1)
  expect(await store<string>(page, 's => s.cards[0].backText')).toBe('the answer')
})

test('preview a card while editing: front, tap to flip to the answer', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'Bio', 'the powerhouse answer')

  // open the preview from the editor header
  await page.getByTestId('preview-card-btn').click()
  await expect(page.getByTestId('card-preview')).toBeVisible()
  // starts on the front — the answer is hidden until flipped
  await expect(page.getByTestId('preview-answer')).toHaveCount(0)

  // tap the card → flips to the answer (real DOM text)
  await page.getByTestId('preview-card').click()
  await expect(page.getByTestId('preview-answer')).toContainText('the powerhouse answer')
  // tap again → back to the front
  await page.getByTestId('preview-card').click()
  await expect(page.getByTestId('preview-answer')).toHaveCount(0)

  // close returns to the editor, still on the same card
  await page.getByTestId('preview-close').click()
  await expect(page.getByTestId('card-preview')).toHaveCount(0)
  await expect(page.getByPlaceholder(/key takeaway/)).toBeVisible()
})

test('review buttons: split button when due, Review all when nothing is due', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'Bio', 'a due card')
  await page.getByTestId('back').click() // editor → deck

  // a brand-new card is due → accent split button, caret opens "Review all"
  await expect(page.getByTestId('review-due')).toContainText('Review (1)')
  await expect(page.locator('[data-testid="review-all"]')).toHaveCount(0)
  await page.getByTestId('review-menu').click()
  await page.getByTestId('review-all-opt').click()
  await expect(page.getByTestId('review-all-modal')).toBeVisible()

  // the dialog can cap the count and pick an order
  await expect(page.getByTestId('ra-count-value')).toHaveText('1')
  await page.getByTestId('ra-inorder').click()
  await page.getByTestId('ra-start').click()
  expect(await store<boolean>(page, 's => s.session.cram === true')).toBe(true)
  expect(await store<number>(page, 's => s.session.queue.length')).toBe(1)
})

test('drag to reorder: order persists and only the moved card is touched', async ({ page }) => {
  await resetApp(page)
  // three cards; the grid shows newest first → c, b, a
  await page.evaluate(() => {
    const w = (window as any).__store
    const mk = (id: string, created: number) => ({
      id, deckId: 'd1', created, updated: created, front: [], back: [],
      backText: id, srs: null, polished: {},
    })
    w.setState({
      decks: [{ id: 'd1', name: 'Order', color: '#e0663c', created: 1 }],
      cards: [mk('a', 1000), mk('b', 2000), mk('c', 3000)],
    })
    w.getState().openDeck('d1')
  })
  const ids = () => store<string[]>(page, "s => s.cards.filter(c=>c.deckId==='d1').slice().sort((x,y)=>(x.order ?? -x.created)-(y.order ?? -y.created)).map(c=>c.id)")
  expect(await ids()).toEqual(['c', 'b', 'a'])

  // move 'a' to the front through the store action the drag handler calls
  await page.evaluate(() => (window as any).__store.getState().reorderCard('d1', 'a', 0))
  expect(await ids()).toEqual(['a', 'c', 'b'])

  // only 'a' got an explicit order — b and c are untouched (sync-friendly)
  expect(await store<boolean>(page, "s => s.cards.find(c=>c.id==='a').order !== undefined")).toBe(true)
  expect(await store<boolean>(page, "s => ['b','c'].every(id => s.cards.find(c=>c.id===id).order === undefined)")).toBe(true)

  // and it survives a reload (persisted)
  await page.waitForTimeout(600)
  await page.reload()
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  expect(await ids()).toEqual(['a', 'c', 'b'])
})

test('touch: long-press drag reorders on mobile', async ({ browser }) => {
  const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await resetApp(page)
  await page.evaluate(() => {
    const w = (window as any).__store
    const mk = (id: string, created: number) => ({
      id, deckId: 'd1', created, updated: created, front: [], back: [],
      backText: id, srs: null, polished: {},
    })
    w.setState({
      decks: [{ id: 'd1', name: 'Order', color: '#e0663c', created: 1 }],
      cards: [mk('a', 1000), mk('b', 2000), mk('c', 3000)],
    })
    w.getState().openDeck('d1')
  })
  const ids = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="card-"]')].map((e) => (e as HTMLElement).dataset.testid!.slice(5)))
  expect(await ids()).toEqual(['c', 'b', 'a']) // newest first

  // real (trusted) touch input via CDP — a synthetic TouchEvent won't drive dnd-kit
  const box = async (id: string) => (await page.locator(`[data-testid="card-${id}"]`).boundingBox())!
  const from = await box('c')
  const to = await box('a')
  const cdp = await ctx.newCDPSession(page)
  const at = (b: { x: number; y: number; width: number; height: number }) =>
    [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }]

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from) })
  await page.waitForTimeout(450) // hold past the 250ms long-press (a quick swipe would just scroll)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(to) })
  await page.waitForTimeout(200)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(300)

  // 'c' long-pressed and dragged onto 'a' → it lands last
  expect(await ids()).toEqual(['b', 'a', 'c'])
  await ctx.close()
})

test('selective review: pick a card, review it, close, pick another', async ({ page }) => {
  await resetApp(page)
  await page.evaluate(() => {
    const w = (window as any).__store
    const mk = (id: string, created: number, text: string) => ({
      id, deckId: 'd1', created, updated: created, front: [], back: [],
      backText: text, srs: null, polished: {},
    })
    w.setState({
      decks: [{ id: 'd1', name: 'Kanji', color: '#e0663c', created: 1 }],
      cards: [mk('a', 1000, 'water = 水'), mk('b', 2000, 'fire = 火')],
    })
    w.getState().openDeck('d1')
  })

  // enter selective review from the combo menu
  await page.getByTestId('review-menu').click()
  await page.getByTestId('review-pick-opt').click()
  await expect(page.getByText('Pick a card to review')).toBeVisible()

  // tapping a card reviews it: front first, tap to reveal the answer
  await page.getByTestId('card-b').click()
  await expect(page.getByTestId('card-preview')).toBeVisible()
  await expect(page.getByTestId('preview-answer')).toHaveCount(0)
  await page.getByTestId('preview-card').click()
  await expect(page.getByTestId('preview-answer')).toContainText('fire = 火')

  // close and pick a different card — no session, no grading, nothing rescheduled
  await page.getByTestId('preview-close').click()
  await page.getByTestId('card-a').click()
  await page.getByTestId('preview-card').click()
  await expect(page.getByTestId('preview-answer')).toContainText('water = 水')
  await page.getByTestId('preview-close').click()
  expect(await store<unknown>(page, 's => s.session')).toBeNull()
  expect(await store<boolean>(page, 's => s.cards.every(c => c.srs === null)')).toBe(true)

  await page.getByTestId('select-done').click()
  await expect(page.getByText('Pick a card to review')).toHaveCount(0)
})

test('move cards to another deck', async ({ page }) => {
  await resetApp(page)
  await page.evaluate(() => {
    const w = (window as any).__store
    const mk = (id: string, created: number) => ({
      id, deckId: 'd1', created, updated: created, front: [], back: [],
      backText: id, srs: null, polished: {}, order: created, // an order from THIS deck
    })
    w.setState({
      decks: [
        { id: 'd1', name: 'Inbox', color: '#e0663c', created: 1 },
        { id: 'd2', name: 'Kanji N5', color: '#3d7dbb', created: 2 },
      ],
      cards: [mk('a', 1000), mk('b', 2000), mk('c', 3000)],
    })
    w.getState().openDeck('d1')
  })

  // select two cards and move them
  await page.getByTestId('select-mode').click()
  await page.getByTestId('select-card-a').click()
  await page.getByTestId('select-card-b').click()
  await expect(page.getByText('2 selected').first()).toBeVisible()
  await page.getByTestId('move-cards').click()
  await expect(page.getByTestId('move-cards-modal')).toBeVisible()
  await page.getByTestId('move-to-d2').click()

  // they land in the other deck, and selection mode closes
  expect(await store<number>(page, "s => s.cards.filter(c => c.deckId === 'd2').length")).toBe(2)
  expect(await store<number>(page, "s => s.cards.filter(c => c.deckId === 'd1').length")).toBe(1)
  await expect(page.getByTestId('select-done')).toHaveCount(0)
  // the old deck's manual order is dropped so they sort naturally in the new deck
  expect(await store<boolean>(page, "s => s.cards.filter(c => c.deckId === 'd2').every(c => c.order === undefined)")).toBe(true)
  // and the move was touched for sync
  expect(await store<boolean>(page, "s => s.cards.filter(c => c.deckId === 'd2').every(c => c.updated > c.created)")).toBe(true)
})
