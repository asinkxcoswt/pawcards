import { expect, test, type Page } from '@playwright/test'
import { inviteLink } from '../src/lib/invite'
import { mintRoomKey } from '../src/lib/tempkey'
import { store } from './helpers'

/**
 * Ready-to-share invite links (#ws= fragment): fresh apps onboard fully
 * (settings from the workshop worker + fresh Sync ID + room pill + popup);
 * configured apps only gain the room. Idempotent across relaunches — the
 * fragment stays in the URL for the iOS Add-to-Home-Screen flow.
 */

const WORKER = 'https://pawshop.test.workers.dev/?key=workshop-key'
const INVITE = {
  url: WORKER,
  code: 'room-e2e1-inv1',
  name: 'Thai Cooking Workshop',
  by: 'John',
  exp: Date.now() + 30 * 24 * 60 * 60 * 1000,
}

function invitePath(p: object): string {
  // inviteLink returns an absolute URL for the production origin — keep only
  // the path?query#fragment so page.goto stays on the test server
  const u = new URL(inviteLink('https://example.test', p as typeof INVITE))
  return u.pathname + u.search + u.hash
}

async function openInvite(page: Page, p: object = INVITE) {
  await page.goto(invitePath(p))
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
}

test('fresh app: invite link onboards settings + room pill + popup', async ({ page }) => {
  await openInvite(page)

  // "John invites you" popup, not the generic onboarding
  await expect(page.getByTestId('invite-popup')).toBeVisible()
  await expect(page.getByTestId('invite-popup')).toContainText('John invites you')
  await expect(page.getByTestId('invite-popup')).toContainText('Thai Cooking Workshop')
  await expect(page.locator('[data-testid="onboarding"]')).toHaveCount(0)

  // main settings adopted from the workshop worker; own Sync ID minted
  expect(await store<string>(page, 's => s.settings.syncUrl')).toBe(WORKER)
  expect(await store<string>(page, 's => s.settings.apiUrl')).toBe(WORKER)
  expect(await store<string>(page, 's => s.settings.provider')).toBe('local')
  expect(await store<string>(page, 's => s.settings.syncId')).toMatch(/^paw-/)
  expect(await store<boolean>(page, 's => s.settings.onboarded')).toBe(true)

  // the room is already on Home (pill), with the invite's expiry
  expect(await store<number>(page, 's => s.rooms.length')).toBe(1)
  expect(await store<string>(page, "s => s.rooms[0].name")).toBe('Thai Cooking Workshop')
  expect(await store<number>(page, 's => s.rooms[0].expiresAt')).toBe(INVITE.exp)

  // Skip keeps the user on Home with the pill visible
  await page.getByTestId('invite-skip').click()
  await expect(page.getByTestId('invite-popup')).toHaveCount(0)
  await expect(page.getByTestId('room-chip-' + INVITE.code)).toBeVisible()
  await expect(page.getByTestId('room-chip-' + INVITE.code)).toContainText('⏳')
})

test('relaunch with the same fragment is quiet (idempotent — PWA install flow)', async ({ page }) => {
  await openInvite(page)
  await page.getByTestId('invite-skip').click()
  await page.waitForTimeout(600) // debounced persist

  await openInvite(page) // simulates the installed PWA relaunching with the URL
  await page.waitForTimeout(300)
  await expect(page.locator('[data-testid="invite-popup"]')).toHaveCount(0)
  expect(await store<number>(page, 's => s.rooms.length')).toBe(1)
})

test('configured app: link adds the room but never touches main settings', async ({ page }) => {
  // configure the app first (own private server), persist, then open the link
  await page.goto('/')
  await page.waitForFunction('window.__store && window.__store.getState().loaded')
  await page.evaluate(() => {
    const w = (window as any).__store
    const s = w.getState()
    w.getState().saveSettings({
      syncUrl: 'https://my-private.worker.dev/?key=mine',
      apiUrl: 'https://my-private.worker.dev/?key=mine',
      syncId: 'paw-mine-mine-mine',
      onboarded: true,
      nickname: 'Khaan',
    })
    return s
  })
  await page.waitForTimeout(600) // debounced persist

  await openInvite(page)
  await expect(page.getByTestId('invite-popup')).toBeVisible()
  // main settings untouched — the room is a bridge with its own url/key
  expect(await store<string>(page, 's => s.settings.syncUrl')).toBe('https://my-private.worker.dev/?key=mine')
  expect(await store<string>(page, 's => s.settings.syncId')).toBe('paw-mine-mine-mine')
  expect(await store<string>(page, 's => s.rooms[0].url')).toBe(WORKER)

  // Join now opens the room screen
  await page.getByTestId('invite-join').click()
  expect(await store<string>(page, 's => s.screen')).toBe('room')
})

test('room-only invite (pr_ key): fresh user joins, but settings stay empty', async ({ page }) => {
  // host who did NOT enable "let guests use my server" → the invite carries a
  // room-only key; the guest joins the room but never adopts the host's server
  const exp = Date.now() + 30 * 24 * 60 * 60 * 1000
  const roomKey = await mintRoomKey('workshop-key', exp)
  const roomOnly = {
    url: 'https://pawshop.test.workers.dev/?key=' + roomKey,
    code: 'room-e2e-ro01',
    name: 'Reading Club',
    by: 'Nong',
    exp,
  }
  await openInvite(page, roomOnly)

  await expect(page.getByTestId('invite-popup')).toBeVisible()
  // the room is joined (pill on Home)…
  expect(await store<number>(page, 's => s.rooms.length')).toBe(1)
  expect(await store<string>(page, "s => s.rooms[0].name")).toBe('Reading Club')
  // …but the host's server was NOT adopted, and onboarding is not marked done
  expect(await store<string>(page, 's => s.settings.syncUrl')).toBe('')
  expect(await store<string>(page, 's => s.settings.apiKey')).toBe('')
  expect(await store<boolean>(page, 's => s.settings.onboarded')).toBe(false)
})

test('expired invite: friendly popup, nothing applied', async ({ page }) => {
  await openInvite(page, { ...INVITE, exp: Date.now() - 1000 })
  await expect(page.getByTestId('invite-expired')).toBeVisible()
  await expect(page.getByTestId('invite-expired')).toContainText('Ask John')
  expect(await store<number>(page, 's => s.rooms.length')).toBe(0)
  expect(await store<string>(page, 's => s.settings.syncUrl')).toBe('')
  await page.getByTestId('invite-expired-close').click()
  await expect(page.locator('[data-testid="invite-expired"]')).toHaveCount(0)
})
