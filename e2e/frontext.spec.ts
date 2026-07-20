import { expect, test } from '@playwright/test'
import { createDeckAndCard, resetApp, store } from './helpers'

test('add a front caption: appears via the Text tool, styles apply, survives to review', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'Bio', 'the mitochondria')

  // add a caption via the Text tool
  await page.getByTestId('text-tool').click()
  await expect(page.getByTestId('front-text-format')).toBeVisible()
  await page.getByTestId('front-text-input').fill('powerhouse of the cell')
  await expect.poll(() => store<string>(page, "s => s.cards[0].frontText?.text")).toBe('powerhouse of the cell')

  // change size (L) and alignment (right) — persisted on the card
  await page.getByRole('button', { name: 'L', exact: true }).click()
  await page.getByRole('button', { name: 'right', exact: true }).click()
  await expect.poll(() => store<number>(page, 's => s.cards[0].frontText.size')).toBe(62)
  await expect.poll(() => store<string>(page, 's => s.cards[0].frontText.align')).toBe('right')

  // tap Done → idle display shows the caption text
  await page.getByTestId('front-text-done').click()
  await expect(page.getByTestId('front-text-display')).toContainText('powerhouse of the cell')

  // the caption shows on the FRONT in review (and is a real DOM node)
  await page.getByTestId('back').click() // editor → deck
  await page.evaluate(() => (window as any).__store.getState().startCram((window as any).__store.getState().decks[0].id))
  await expect(page.getByTestId('review-card')).toContainText('powerhouse of the cell')
})

test('caption box keeps the SAME height in edit mode and after Done (no jump)', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'X', 'answer')
  await page.getByTestId('text-tool').click()

  // single line — this is where the old rows=2 default made editing 2 lines tall
  await page.getByTestId('front-text-input').fill('one line')
  const editH1 = (await page.getByTestId('front-text-input').boundingBox())!.height
  await page.getByTestId('front-text-done').click()
  const viewH1 = (await page.getByTestId('front-text-display').boundingBox())!.height
  expect(Math.abs(editH1 - viewH1)).toBeLessThanOrEqual(2)

  // multi-line (incl. Thai) — wrapping must match too
  await page.getByTestId('front-text-display').click()
  await page.getByTestId('front-text-input').fill('เผชิญหน้ากับความจริง\nand a second, much longer line that wraps')
  const editH2 = (await page.getByTestId('front-text-input').boundingBox())!.height
  await page.getByTestId('front-text-done').click()
  const viewH2 = (await page.getByTestId('front-text-display').boundingBox())!.height
  expect(Math.abs(editH2 - viewH2)).toBeLessThanOrEqual(2)
  expect(viewH2).toBeGreaterThan(viewH1) // sanity: it really was multi-line
})

test('caption can be removed with the delete button', async ({ page }) => {
  await resetApp(page)
  await createDeckAndCard(page, 'X', 'answer')
  await page.getByTestId('text-tool').click()
  await page.getByTestId('front-text-input').fill('label')
  await expect.poll(() => store<string>(page, "s => s.cards[0].frontText?.text")).toBe('label')
  await page.getByTestId('front-text-delete').click()
  expect(await store<boolean>(page, 's => !s.cards[0].frontText')).toBe(true)
  await expect(page.getByTestId('front-text-display')).toHaveCount(0)
})
