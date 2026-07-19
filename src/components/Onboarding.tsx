import { useState } from 'react'
import { useStore } from '../store'
import { newSyncId } from '../lib/settings'
import type { ConfigPayload } from '../lib/qrconfig'
import QrConfigModal from './QrConfigModal'

/**
 * First-run welcome. Shown only on a genuinely fresh install (see App). Two
 * ways forward: scan a setup QR (from a friend or the deploy script), or skip
 * and configure later in Settings. Full backend provisioning is deliberately
 * not here — see the discussion in the session notes.
 */
export default function Onboarding() {
  const settings = useStore((s) => s.settings)
  const { saveSettings, showToast } = useStore.getState()
  const [scanning, setScanning] = useState(false)

  const applyScanned = (cfg: ConfigPayload) => {
    // friend-shared codes carry no Sync ID — keep this device's own
    saveSettings({ ...cfg, syncId: cfg.syncId || settings.syncId.trim() || newSyncId(), onboarded: true })
    setScanning(false)
    showToast('Settings applied — welcome! 🐾')
  }

  if (scanning) {
    return (
      <QrConfigModal
        mode="scan"
        config={{
          provider: settings.provider,
          apiKey: settings.apiKey,
          apiUrl: settings.apiUrl,
          model: settings.model,
          prompt: settings.prompt,
          syncUrl: settings.syncUrl,
          syncId: settings.syncId,
        }}
        onApply={applyScanned}
        onClose={() => setScanning(false)}
      />
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(30,25,18,.5)]">
      <div
        className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        data-testid="onboarding"
      >
        <div className="mb-1 text-center text-[34px]">🐾</div>
        <h2 className="m-0 mb-1 text-center text-[19px] font-bold">Welcome to PawCards</h2>
        <p className="hint mb-4 text-center">
          Draw-first flashcards, stored on this device. To generate card images or sync across devices, point the app at
          a Worker — you can do it now with a QR, or anytime in Settings.
        </p>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary" data-testid="onboard-scan" onClick={() => setScanning(true)}>
            📷 Scan a setup QR
          </button>
          <p className="hint mb-1 text-center text-[12px]">
            Got a QR from a friend or your deploy script? Scan it to configure everything at once.
          </p>
          <button className="btn btn-ghost" data-testid="onboard-skip" onClick={() => saveSettings({ onboarded: true })}>
            Skip — I'll set up later
          </button>
        </div>
      </div>
    </div>
  )
}
