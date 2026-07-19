import { expect, test } from '@playwright/test'
import { createDeckAndCard, drawLine, resetApp, store } from './helpers'

const WORKER = 'https://pawpolish.test.workers.dev'

let lastPolishBody: { prompt?: string } = {}

test.beforeEach(async ({ page }) => {
  lastPolishBody = {}
  // a real red PNG so the background composite is pixel-verifiable
  await page.goto('/')
  const red = await page.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 64
    cv.height = 40
    const x = cv.getContext('2d')!
    x.fillStyle = '#d40000'
    x.fillRect(0, 0, 64, 40)
    return cv.toDataURL('image/png').split(',')[1]
  })
  await page.route(WORKER + '/**', (route) => {
    lastPolishBody = JSON.parse(route.request().postData() ?? '{}')
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ images: [red] }) })
  })
  await resetApp(page, { provider: 'local', apiUrl: WORKER + '/?key=pw' })
})

test('✨ with no answer → tender error, no API call', async ({ page }) => {
  await createDeckAndCard(page, 'X', '')
  await page.getByTestId('generate').click()
  await expect(page.locator('#toast')).toContainText('Tell me the answer first')
  await expect(page.getByPlaceholder(/key takeaway/)).toBeFocused()
})

test('✨ generates from the answer; ink survives on top; ✕ image clears bg only', async ({ page }) => {
  await createDeckAndCard(page, 'X', 'osmosis moves water across membranes')
  await drawLine(page, 30, 120, 150, 140)

  await page.getByTestId('generate').click()
  await expect(page.locator('#toast')).toContainText('Image ready', { timeout: 5000 })
  const prompt = lastPolishBody.prompt ?? ''
  expect(prompt.startsWith('osmosis moves water')).toBe(true)
  expect(prompt).toContain('sticker art')

  // background visible under ink in the editor canvas
  await page.waitForTimeout(300)
  const corner = await page.evaluate(() => {
    const cv = document.querySelector('section canvas') as HTMLCanvasElement
    const d = cv.getContext('2d')!.getImageData(5, 5, 1, 1).data
    return { r: d[0], g: d[1] }
  })
  expect(corner.r).toBeGreaterThan(180)
  expect(corner.g).toBeLessThan(80)

  // drawing on top still works
  const before = await store<number>(page, 's => s.cards[0].front.length')
  await drawLine(page, 40, 60, 170, 80)
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(before + 1)

  // ✕ image (double-tap confirm) removes bg, keeps ink
  await page.getByTestId('clear-image').click()
  await page.getByText('Remove?').click()
  expect(await store<boolean>(page, 's => !s.cards[0].polished.front')).toBe(true)
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(before + 1)
})

test('combo menu → custom prompt generates from the typed text, not the answer', async ({ page }) => {
  await createDeckAndCard(page, 'X', 'the real answer')
  await page.getByTestId('gen-menu').click()
  await page.getByTestId('gen-custom').click()

  // empty prompt is rejected before any API call
  await page.getByTestId('custom-prompt-input').fill('')
  await page.getByTestId('custom-prompt-go').click()
  await expect(page.locator('#toast')).toContainText('Describe the image first')

  await page.getByTestId('custom-prompt-input').fill('a red panda juggling teacups')
  await page.getByTestId('custom-prompt-go').click()
  await expect(page.locator('#toast')).toContainText('Image ready', { timeout: 5000 })
  const prompt = lastPolishBody.prompt ?? ''
  expect(prompt.startsWith('a red panda juggling teacups')).toBe(true)
  expect(prompt).not.toContain('the real answer')
  expect(await store<string>(page, 's => s.cards[0].subject')).toBe('a red panda juggling teacups')

  // the dialog always opens blank — never prefilled from the answer or a previous prompt
  await page.getByTestId('gen-menu').click()
  await page.getByTestId('gen-custom').click()
  await expect(page.getByTestId('custom-prompt-input')).toHaveValue('')
})

test('regenerating replaces the background without touching ink', async ({ page }) => {
  await createDeckAndCard(page, 'X', 'an answer')
  await page.getByTestId('generate').click()
  await expect(page.locator('#toast')).toContainText('Image ready', { timeout: 5000 })
  await drawLine(page, 50, 50, 120, 90)
  await page.getByTestId('generate').click()
  await expect(page.locator('#toast')).toContainText('Image ready', { timeout: 5000 })
  expect(await store<number>(page, 's => s.cards[0].front.length')).toBe(1)
  expect(await store<boolean>(page, 's => !!s.cards[0].polished.front')).toBe(true)
})
