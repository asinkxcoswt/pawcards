import { useState } from 'react'
import { useStore } from '../store'
import { newSyncId } from '../lib/settings'
import { SETUP_GUIDE_URL } from '../lib/constants'
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,25,18,.5)] p-4">
      <div className="w-full max-w-[420px] rounded-[20px] bg-panel p-5 shadow-soft" data-testid="onboarding">
        <div className="mb-1 text-center text-[34px]">🐾</div>
        <h2 className="m-0 mb-1 text-center text-[19px] font-bold">Welcome to PawCards</h2>
        <p className="hint mb-4 text-center">
          To generate card images and sync across devices, ask a friend who uses PawCards for a setup QR — then scan it
          here.
        </p>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary" data-testid="onboard-scan" onClick={() => setScanning(true)}>
            📷 Scan a setup QR
          </button>
          <button className="btn btn-ghost" data-testid="onboard-skip" onClick={() => saveSettings({ onboarded: true })}>
            Skip — I'll set up later
          </button>
        </div>
        <p className="hint mt-4 text-center text-[12px]">
          Setting up your own?{' '}
          <a href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer" className="font-semibold text-accent underline" data-testid="onboard-guide">
            Follow the guide on GitHub ↗
          </a>
        </p>
      </div>
    </div>
  )
}
