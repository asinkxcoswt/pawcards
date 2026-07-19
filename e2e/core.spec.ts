import { expect, test } from '@playwright/test'
import { createDeckAndCard, drawLine, resetApp, store } from './helpers'

test('deck → card → draw → review → Easy retires → shuffle rescue', async ({ page }) => {
  await resetApp(page)

  // deck creation via modal (Enter submits)
  await page.getByText('＋ New deck').click()
  await page.getByPlaceholder('Deck name').fill('Biology')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Biology' })).toBeVisible()

  // new card opens the editor with the answer box focused
  await page.getByText('＋ New card').click()
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

  // shuffle rescue: Again on the retired card un-retires it
  await page.getByText('Biology').click()
  await page.getByText('Shuffle all').click()
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
