/**
 * "Add to Home Screen" helpers. Android/Chrome fires `beforeinstallprompt`,
 * which we capture so a button can trigger the native install dialog. iOS
 * Safari has no such API — only manual Share → Add to Home Screen — so there
 * we can show instructions but no button.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // stop Chrome's mini-infobar; we'll prompt from our button
    deferred = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
  })
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferred
}
export function clearDeferredPrompt(): void {
  deferred = null
}

/** already running as an installed app? then never offer to install */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export type Platform = 'ios' | 'android' | 'other'

export function detectPlatform(
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouch: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0,
): Platform {
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPadOS 13+ reports a Mac UA but is touch-capable
  if (/macintosh/i.test(ua) && maxTouch > 1) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'other'
}

const DISMISS_KEY = 'paw-install-dismissed'
export function installDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}
export function dismissInstall(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1')
  } catch {
    /* private mode — fine, it'll just ask again next open */
  }
}
