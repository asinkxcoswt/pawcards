import { expect, test, type Page } from '@playwright/test'
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

/** wait for the async QRCode.toCanvas draw to actually paint (light pixel check) */
async function waitQrPainted(canvas: ReturnType<Page['getByTestId']>) {
  await expect(canvas).toBeVisible()
  await expect
    .poll(
      () =>
        canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement
          if (!c.width) return 0
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
          let n = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] < 128) n++
          return n
        }),
      { timeout: 6000 },
    )
    .toBeGreaterThan(1000)
}

/** inject jsQR into the page so we can decode in-browser (no slow pixel transfer over CDP) */
async function ensureJsQR(page: Page) {
  if (await page.evaluate(() => 'jsQR' in window)) return
  await page.addScriptTag({ path: 'node_modules/jsqr/dist/jsQR.js' })
}

/** decode the rendered QR canvas in-page, retrying at resampled sizes (headless AA defeats a single read) */
async function decodeShownQr(page: Page) {
  const canvas = page.getByTestId('qr-canvas')
  await waitQrPainted(canvas)
  await ensureJsQR(page)
  const data = await canvas.evaluate((el) => {
    const src = el as HTMLCanvasElement
    const g = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR
    for (const w of [600, 900, 450, 300]) {
      const off = document.createElement('canvas')
      off.width = w
      off.height = w
      const ctx = off.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(src, 0, 0, w, w)
      const code = g(ctx.getImageData(0, 0, w, w).data, w, w)
      if (code) return code.data
    }
    return null
  })
  expect(data).not.toBeNull()
  return parseConfig(data!)
}

/** a crisp, upscaled PNG of a QR canvas, for feeding the app's own scanner */
function upscaledPng(canvas: ReturnType<Page['getByTestId']>) {
  return canvas.evaluate((el) => {
    const src = el as HTMLCanvasElement
    const s = 3
    const off = document.createElement('canvas')
    off.width = src.width * s
    off.height = src.height * s
    const ctx = off.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(src, 0, 0, off.width, off.height)
    return off.toDataURL('image/png')
  })
}

test('fresh install shows onboarding; Skip dismisses it and does not return', async ({ page }) => {
  await resetApp(page, { onboarded: false }) // simulate a first run
  await expect(page.getByTestId('onboarding')).toBeVisible()
  await page.getByTestId('onboard-skip').click()
  await expect(page.getByTestId('onboarding')).toHaveCount(0)
  expect(await store<boolean>(page, 's => s.settings.onboarded')).toBe(true)
  // reloading keeps it dismissed — wait for the debounced IndexedDB write first
  await page.waitForTimeout(600)
  await page.reload()
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  await expect(page.getByTestId('onboarding')).toHaveCount(0)
})

test('onboarding Scan → applies a friend/deploy settings QR and dismisses', async ({ browser }) => {
  // device A produces a settings QR image
  const A = await (await browser.newContext()).newPage()
  await openSettings(A)
  await A.getByTestId('qr-show').click()
  await waitQrPainted(A.getByTestId('qr-canvas'))
  const dataUrl = await upscaledPng(A.getByTestId('qr-canvas'))
  const png = Buffer.from(dataUrl.split(',')[1], 'base64')

  // device B is a fresh install → onboarding → Scan → pick the image
  const B = await (await browser.newContext()).newPage()
  await resetApp(B, { onboarded: false })
  await expect(B.getByTestId('onboarding')).toBeVisible()
  await B.getByTestId('onboard-scan').click()
  await B.getByTestId('qr-file-input').setInputFiles({ name: 'setup.png', mimeType: 'image/png', buffer: png })
  await expect(B.getByTestId('qr-summary')).toBeVisible({ timeout: 5000 })
  await B.getByTestId('qr-apply').click()

  expect(await store<string>(B, 's => s.settings.syncUrl')).toBe('https://paw.e2e.workers.dev/?key=sync')
  expect(await store<boolean>(B, 's => s.settings.onboarded')).toBe(true)
  await expect(B.getByTestId('onboarding')).toHaveCount(0)
})

test('settings QR renders a scannable code', async ({ page }) => {
  // the content round-trip is covered by the unit tests (encode/parse) and by
  // the "scan from a photo" e2e (full config decoded through the real scanner);
  // here we only assert the QR actually painted.
  await openSettings(page)
  await page.getByTestId('qr-show').click()
  await waitQrPainted(page.getByTestId('qr-canvas'))
})

test('scan from a photo: device A\'s QR image imports on device B (full loop, no camera)', async ({ browser }) => {
  // device A renders its settings QR
  const A = await (await browser.newContext()).newPage()
  await openSettings(A)
  await A.getByTestId('qr-show').click()
  const canvas = A.getByTestId('qr-canvas')
  await waitQrPainted(canvas)
  const dataUrl = await upscaledPng(canvas)
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
})

test('picking a photo with no QR shows a friendly error', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('qr-scan').click()
  const blank = await page.evaluate(() => {
    const cv = document.createElement('canvas')
    cv.width = 200
    cv.height = 200
    cv.getContext('2d')!.fillStyle = '#fff'
    cv.getContext('2d')!.fillRect(0, 0, 200, 200)
    return cv.toDataURL('image/png')
  })
  await page.getByTestId('qr-file-input').setInputFiles({
    name: 'nothing.png',
    mimeType: 'image/png',
    buffer: Buffer.from(blank.split(',')[1], 'base64'),
  })
  await expect(page.getByText(/No QR code found/)).toBeVisible({ timeout: 10_000 })
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
  // restores to the (non-empty) default style
  await expect.poll(() => store<string>(page, 's => s.settings.prompt.length > 10')).toBe(true)
})

test('combo menu → Share with friend leaves the Sync ID out', async ({ page }) => {
  await openSettings(page)
  await page.getByTestId('qr-show-menu').click()
  await page.getByTestId('qr-share-friend').click()
  const cfg = await decodeShownQr(page)
  expect(cfg.syncId).toBe('')
  expect(cfg.apiUrl).toBe('https://paw.e2e.workers.dev/?key=gen')
})

test('theme switcher changes the document theme and persists', async ({ page }) => {
  await resetApp(page, { theme: 'ink' })
  await page.getByTitle('Settings').click()
  await page.getByTestId('theme-paper').click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('paper')
  expect(await store<string>(page, 's => s.settings.theme')).toBe('paper')
  await page.getByTestId('theme-ink').click()
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe('ink')
})
