import { expect, test, type Page } from '@playwright/test'
import jsQR from 'jsqr'
import { parseConfig } from '../src/lib/qrconfig'
import { resetApp, store } from './helpers'

async function openSettings(page: Page) {
  await resetApp(page, {
    provider: 'local',
    apiUrl: 'https://paw.e2e.workers.dev/?key=gen',
    syncUrl: 'https://paw.e2e.workers.dev/?key=sync',
    syncId: 'paw-e2e-qr-0001',
  })
  await page.getByTitle('Settings').click()
}

/** decode the rendered QR canvas with a real QR decoder */
async function decodeShownQr(page: Page) {
  const canvas = page.getByTestId('qr-canvas')
  await expect(canvas).toBeVisible()
  const img = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { data: Array.from(d.data), width: d.width, height: d.height }
  })
  const code = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)
  expect(code).not.toBeNull()
  return parseConfig(code!.data)
}

test('settings QR renders and decodes back to the device config', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('qr-show').click()
  const cfg = await decodeShownQr(page)
  expect(cfg.syncId).toBe('paw-e2e-qr-0001')
  expect(cfg.syncUrl).toBe('https://paw.e2e.workers.dev/?key=sync')
  expect(cfg.provider).toBe('local')
})

test('scan from a photo: device A\'s QR image imports on device B (full loop, no camera)', async ({ browser }) => {
  // device A renders its settings QR
  const A = await (await browser.newContext()).newPage()
  await openSettings(A)
  await A.getByTestId('qr-show').click()
  const canvas = A.getByTestId('qr-canvas')
  await expect(canvas).toBeVisible()
  const dataUrl = await canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL('image/png'))
  const png = Buffer.from(dataUrl.split(',')[1], 'base64')

  // device B picks that image in the scanner instead of using a camera
  const B = await (await browser.newContext()).newPage()
  await resetApp(B)
  await B.getByTitle('Settings').click()
  await B.getByTestId('qr-scan').click()
  await B.getByTestId('qr-file-input').setInputFiles({ name: 'settings-qr.png', mimeType: 'image/png', buffer: png })

  await expect(B.getByTestId('qr-summary')).toBeVisible({ timeout: 5000 })
  await B.getByTestId('qr-apply').click()
  expect(await store<string>(B, 's => s.settings.syncUrl')).toBe('https://paw.e2e.workers.dev/?key=sync')
  expect(await store<string>(B, 's => s.settings.syncId')).toBe('paw-e2e-qr-0001')

  // a photo without any QR gives a friendly error and keeps the scanner open
  // (the settings modal is still open after applying)
  await B.getByTestId('qr-scan').click()
  const blank = await B.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 200
    cv.height = 200
    cv.getContext('2d')!.fillStyle = '#fff'
    cv.getContext('2d')!.fillRect(0, 0, 200, 200)
    return cv.toDataURL('image/png')
  })
  await B.getByTestId('qr-file-input').setInputFiles({
    name: 'nothing.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank.split(',')[1], 'base64'),
  })
  await expect(B.getByText(/No QR code found/)).toBeVisible()
})

test('settings QR has a Share/Save button; desktop path downloads the image', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('qr-show').click()
  await expect(page.getByTestId('qr-canvas')).toBeVisible()
  // headless has no Web Share file support → falls back to a download
  const download = page.waitForEvent('download')
  await page.getByTestId('qr-share-btn').click()
  expect((await download).suggestedFilename()).toBe('pawcards-settings-qr.png')
})

test('nickname is editable in settings and saves in real time', async ({ page }) => {
  await resetApp(page)
  await page.getByTitle('Settings').click()
  await page.getByTestId('nickname-input').fill('Khaan')
  await expect.poll(() => store<string>(page, 's => s.settings.nickname')).toBe('Khaan')
  // reopening shows the saved value
  await page.getByTestId('settings-close').click()
  await page.getByTitle('Settings').click()
  await expect(page.getByTestId('nickname-input')).toHaveValue('Khaan')
})

test('settings fields save in real time — no Save button', async ({ page }) => {
  await resetApp(page)
  await page.getByTitle('Settings').click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)

  await page.locator('textarea').fill('my realtime style')
  await expect.poll(() => store<string>(page, 's => s.settings.prompt')).toBe('my realtime style')

  // close (top-right ✕) without any save step — the store keeps the value
  await page.getByTestId('settings-close').click()
  expect(await store<string>(page, 's => s.settings.prompt')).toBe('my realtime style')

  // an emptied field falls back to the default on blur
  await page.getByTitle('Settings').click()
  await page.locator('textarea').fill('')
  await page.locator('textarea').blur()
  await expect.poll(() => store<string>(page, 's => s.settings.prompt')).toContain('cute flat sticker art')
})

test('combo menu → Share with friend leaves the Sync ID out', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('qr-show-menu').click()
  await page.getByTestId('qr-share-friend').click()
  const cfg = await decodeShownQr(page)
  expect(cfg.syncId).toBe('')
  expect(cfg.apiUrl).toBe('https://paw.e2e.workers.dev/?key=gen')
})
