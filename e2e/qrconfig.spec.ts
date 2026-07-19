import { expect, test } from '@playwright/test'
import jsQR from 'jsqr'
import { parseConfig } from '../src/lib/qrconfig'
import { resetApp } from './helpers'

test('settings QR renders and decodes back to the device config', async ({ page }) => {
  await resetApp(page, {
    provider: 'local',
    apiUrl: 'https://paw.e2e.workers.dev/?key=gen',
    syncUrl: 'https://paw.e2e.workers.dev/?key=sync',
    syncId: 'paw-e2e-qr-0001',
  })
  await page.getByTitle('Settings').click()
  await page.getByTestId('qr-show').click()

  const canvas = page.getByTestId('qr-canvas')
  await expect(canvas).toBeVisible()
  // pull the rendered pixels out and decode them with a real QR decoder
  const img = await canvas.evaluate((el) => {
    const c = el as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    return { data: Array.from(d.data), width: d.width, height: d.height }
  })
  const code = jsQR(new Uint8ClampedArray(img.data), img.width, img.height)
  expect(code).not.toBeNull()
  const cfg = parseConfig(code!.data)
  expect(cfg.syncId).toBe('paw-e2e-qr-0001')
  expect(cfg.syncUrl).toBe('https://paw.e2e.workers.dev/?key=sync')
  expect(cfg.provider).toBe('local')
})
