import { useEffect, useState } from 'react'
import { clearDeferredPrompt, dismissInstall, getDeferredPrompt, type BeforeInstallPromptEvent } from '../lib/pwa'
import Icon from './Icon'

/**
 * "Add to Home Screen" invite, shown in a browser tab (not when installed).
 * Android: a real Install button (native dialog). iOS: manual instructions,
 * since Safari has no install API. onDone fires after install or dismiss.
 */
export default function InstallPrompt({ platform, onDone }: { platform: 'ios' | 'android'; onDone: () => void }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(getDeferredPrompt())

  // the beforeinstallprompt event can arrive after we mount
  useEffect(() => {
    if (platform !== 'android' || deferred) return
    const onEvt = (e: Event) => setDeferred(e as BeforeInstallPromptEvent)
    window.addEventListener('beforeinstallprompt', onEvt)
    return () => window.removeEventListener('beforeinstallprompt', onEvt)
  }, [platform, deferred])

  const skip = () => {
    dismissInstall()
    onDone()
  }

  const install = async () => {
    const evt = deferred ?? getDeferredPrompt()
    if (!evt) return
    await evt.prompt()
    await evt.userChoice.catch(() => undefined)
    clearDeferredPrompt()
    dismissInstall()
    onDone()
  }

  const canPrompt = platform === 'android' && !!deferred

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(30,25,18,.5)] p-4">
      <div className="w-full max-w-[420px] rounded-[20px] bg-panel p-5 shadow-soft" data-testid="install-prompt">
        <div className="mb-1 flex justify-center text-accent">
          <Icon name="install" size={34} strokeWidth={1.6} />
        </div>
        <h2 className="m-0 mb-1 text-center text-[19px] font-bold">Add PawCards to your home screen</h2>
        <p className="hint mb-4 text-center">
          Install it for a full-screen, app-like experience — it opens instantly and works like a native app.
        </p>

        {canPrompt ? (
          <div className="flex flex-col gap-2">
            <button className="btn btn-primary justify-center" data-testid="install-go" onClick={() => void install()}>
              <Icon name="import" size={16} /> Install app
            </button>
            <button className="btn btn-ghost" data-testid="install-skip" onClick={skip}>
              Not now
            </button>
          </div>
        ) : platform === 'ios' ? (
          <>
            <div className="mb-4 rounded-xl bg-paper p-3.5 text-[14px] leading-relaxed">
              <div className="mb-1">
                1. Tap the <b>Share</b> button <span className="whitespace-nowrap">( ⬆️ box-with-arrow )</span> in Safari's
                toolbar.
              </div>
              <div>
                2. Choose <b>Add to Home Screen</b> <span className="whitespace-nowrap">( ➕ )</span>.
              </div>
            </div>
            <button className="btn btn-ghost w-full" data-testid="install-skip" onClick={skip}>
              Got it
            </button>
          </>
        ) : (
          // Android without a usable prompt event (browser not ready / unsupported)
          <>
            <p className="hint mb-4 text-center text-[14px]">
              Open your browser menu <b>(⋮)</b> and choose <b>Install app</b> / <b>Add to Home screen</b>.
            </p>
            <button className="btn btn-ghost w-full" data-testid="install-skip" onClick={skip}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  )
}
