import { useEffect, useRef, useState } from 'react'
import { useStore } from './store'
import { syncConfigured } from './lib/sync'
import { needsUpdate } from './lib/version'
import { APP_VERSION } from './lib/constants'
import Home from './components/Home'
import DeckView from './components/DeckView'
import Editor from './components/Editor'
import Review from './components/Review'
import RoomView from './components/RoomView'
import Onboarding from './components/Onboarding'
import InstallPrompt from './components/InstallPrompt'
import InviteGate from './components/InviteGate'
import { parseInviteFragment } from './lib/invite'
import { detectPlatform, installDismissed, isStandalone } from './lib/pwa'
import Toast from './components/Toast'

// parsed once at module load. Applies in the browser tab it's opened in (and,
// on Android, in the installed PWA — shared storage). NOT on iOS installs: iOS
// drops the #fragment on Add-to-Home-Screen (launches from manifest start_url),
// so an iOS install starts empty. See InviteGate.
const bootInvite = typeof location !== 'undefined' ? parseInviteFragment(location.hash) : null

export default function App() {
  const screen = useStore((s) => s.screen)
  const loaded = useStore((s) => s.loaded)
  const init = useStore((s) => s.init)
  const settings = useStore((s) => s.settings)
  // offer "add to home screen" in a mobile browser tab (once, until dismissed/installed)
  const installPlatform = detectPlatform()
  const [installOffered, setInstallOffered] = useState(
    () =>
      isStandalone() ||
      installDismissed() ||
      bootInvite !== null || // invited users aren't rushed to install — Settings has it
      (installPlatform !== 'ios' && installPlatform !== 'android'),
  )
  const [updateTo, setUpdateTo] = useState<string | null>(null)
  const updateDismissed = useRef(false)

  useEffect(() => {
    void init()
  }, [init])

  // apply the theme to <html> (and mirror to localStorage so index.html can
  // set it before first paint — no flash of the default theme)
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme
    try {
      localStorage.setItem('paw-theme', settings.theme)
    } catch {
      /* private mode — fine */
    }
  }, [settings.theme])

  // update check: on open and whenever the PWA comes back to the foreground.
  // Only minor/major bumps prompt; patch releases arrive on a natural reload.
  useEffect(() => {
    const check = async () => {
      if (updateDismissed.current) return
      try {
        const rsp = await fetch('/version.json?t=' + Date.now(), { cache: 'no-store' })
        if (!rsp.ok) return
        const { version } = (await rsp.json()) as { version?: string }
        if (typeof version === 'string' && needsUpdate(APP_VERSION, version)) setUpdateTo(version)
      } catch {
        /* offline or dev server — never bother the user */
      }
    }
    void check()
    const onVis = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // push pending changes when the user leaves the app
  useEffect(() => {
    const onVis = () => {
      const s = useStore.getState()
      if (document.visibilityState === 'hidden' && syncConfigured(s.settings)) void s.syncNow(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  if (!loaded) return null

  // install invite comes first; onboarding waits until it's answered
  const showInstall = !installOffered
  // first-run setup prompt: keyed on the `onboarded` flag + no backend, NOT on
  // an empty library — every new user is now seeded the example deck, so the
  // library is never empty (the flag is the real "hasn't set up yet" signal).
  // Suppressed while an invite link is applying (InviteGate onboards instead).
  const showOnboarding =
    !showInstall &&
    !bootInvite &&
    !settings.onboarded &&
    !settings.syncUrl.trim() &&
    !settings.apiKey.trim()

  return (
    <div className="h-dvh flex flex-col overflow-hidden">
      {screen === 'home' && <Home />}
      {screen === 'deck' && <DeckView />}
      {screen === 'editor' && <Editor />}
      {screen === 'review' && <Review />}
      {screen === 'room' && <RoomView />}
      {showInstall && (
        <InstallPrompt platform={installPlatform as 'ios' | 'android'} onDone={() => setInstallOffered(true)} />
      )}
      {showOnboarding && <Onboarding />}
      {bootInvite && <InviteGate invite={bootInvite} />}
      <Toast />
      {updateTo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(30,25,18,.4)]">
          <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }} data-testid="update-popup">
            <h2 className="m-0 mb-1 text-[17px] font-bold">✨ Update available</h2>
            <p className="hint mb-3.5">
              PawCards v{updateTo} is out — you're on v{APP_VERSION}. Updating just reloads the app; your cards stay on
              this device.
            </p>
            <div className="flex gap-2.5">
              <button className="btn btn-primary" data-testid="update-reload" onClick={() => window.location.reload()}>
                ↻ Update now
              </button>
              <button
                className="btn btn-ghost"
                data-testid="update-later"
                onClick={() => {
                  updateDismissed.current = true
                  setUpdateTo(null)
                }}
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
