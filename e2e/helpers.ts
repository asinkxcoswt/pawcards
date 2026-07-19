import type { Page } from '@playwright/test'

/** the store test hook exposed on window by src/store.ts */
export async function store<T>(page: Page, fn: string): Promise<T> {
  return page.evaluate(`(() => { const s = window.__store.getState(); return (${fn})(s); })()`) as Promise<T>
}

export async function resetApp(page: Page, settings: Record<string, unknown> = {}) {
  await page.goto('/')
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  await page.evaluate((patch) => {
    const w = window as unknown as { __store: { getState: () => any; setState: (p: any) => void } }
    const s = w.__store.getState()
    w.__store.setState({
      decks: [],
      cards: [],
      tombstones: {},
      settings: { ...s.settings, ...patch },
      screen: 'home',
      curDeckId: null,
      curCardId: null,
      session: null,
    })
  }, settings)
}

export async function createDeckAndCard(page: Page, deckName: string, answer: string) {
  await page.getByText('＋ New deck').click()
  await page.getByPlaceholder('Deck name').fill(deckName)
  await page.keyboard.press('Enter')
  await page.getByText('＋ New card').click()
  await page.getByPlaceholder(/key takeaway/).fill(answer)
}

export async function drawLine(page: Page, dx1: number, dy1: number, dx2: number, dy2: number) {
  const box = (await page.locator('canvas').last().boundingBox())!
  await page.mouse.move(box.x + dx1, box.y + dy1)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(box.x + dx1 + ((dx2 - dx1) * i) / 10, box.y + dy1 + ((dy2 - dy1) * i) / 10)
  }
  await page.mouse.up()
}
