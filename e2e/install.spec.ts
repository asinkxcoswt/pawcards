import { expect, test } from '@playwright/test'
import { resetApp } from './helpers'

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

test('mobile browser: install invite shows before onboarding; dismiss persists', async ({ browser }) => {
  const ctx = await browser.newContext({ userAgent: IOS_UA })
  const page = await ctx.newPage()
  await resetApp(page, { onboarded: false })

  // install invite first; onboarding waits behind it
  await expect(page.getByTestId('install-prompt')).toBeVisible()
  await expect(page.getByText(/Add to Home Screen/)).toBeVisible() // iOS instructions, no button
  await expect(page.getByTestId('onboarding')).toHaveCount(0)

  // dismiss → onboarding now appears
  await page.getByTestId('install-skip').click()
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)
  await expect(page.getByTestId('onboarding')).toBeVisible()

  // reload in the same context → invite stays dismissed (localStorage)
  await page.reload()
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)

  await ctx.close()
})

test('desktop browser: no install invite', async ({ page }) => {
  await resetApp(page, { onboarded: false })
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)
  // a fresh desktop install goes straight to onboarding
  await expect(page.getByTestId('onboarding')).toBeVisible()
})
