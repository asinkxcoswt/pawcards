import { expect, test } from '@playwright/test'
import { resetApp } from './helpers'

test('minor-version bump → update popup; Later dismisses for the session', async ({ page }) => {
  await page.route('**/version.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"9.9.0"}' }),
  )
  await resetApp(page)
  await expect(page.getByTestId('update-popup')).toBeVisible()
  await expect(page.getByTestId('update-popup')).toContainText('v9.9.0')
  await page.getByTestId('update-later').click()
  await expect(page.getByTestId('update-popup')).toHaveCount(0)
})

test('patch bump stays silent', async ({ page }) => {
  await page.route('**/version.json*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":"3.3.99"}' }),
  )
  await resetApp(page)
  await page.waitForTimeout(400) // give the check time to run
  await expect(page.getByTestId('update-popup')).toHaveCount(0)
})
