import { expect, test } from '@playwright/test'
import { resetApp } from './helpers'

const THAI =
  'ทุกคำพูดคือการเลือกเส้น timeline ของชีวิต\nคนที่เข้าใจเรื่องนี้ เค้าจะไม่พูดถึงสิ่งที่เค้าไม่ต้องการ แต่จะพูดเฉพาะสิ่งที่ตัวเองอยากให้เกิดขึ้นเท่านั้น'

test('Thai answer renders as DOM text, fits the card, uses the Thai font stack', async ({ page }) => {
  await resetApp(page)
  await page.evaluate((backText) => {
    const w = (window as any).__store
    w.setState({
      decks: [{ id: 'd', name: 'Power of Words', color: '#e0663c', created: 1 }],
      cards: [{ id: 'c', deckId: 'd', created: 1, updated: 1, front: [], back: [], backText, srs: null, polished: {} }],
      curDeckId: 'd',
    })
    w.getState().startCram('d')
  }, THAI)

  await page.getByTestId('review-card').click()
  const answer = page.getByTestId('review-answer')
  await expect(answer).toContainText('ทุกคำพูด')

  // the overlay is real DOM text → native Thai line breaking; it must fit the card
  const fits = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="review-answer"]') as HTMLElement
    const card = document.querySelector('[data-testid="review-card"]') as HTMLElement
    return t.scrollWidth <= card.clientWidth + 1 && t.scrollHeight <= card.clientHeight + 1
  })
  expect(fits).toBe(true)

  const fontFamily = await answer.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(fontFamily).toContain('Sukhumvit Set')
})
