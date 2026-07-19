import { useRef, useState } from 'react'
import { useStore } from '../store'
import { APP_VERSION } from '../lib/constants'
import { defaultSettings, providerDefaults } from '../lib/settings'
import { syncConfigured } from '../lib/sync'
import type { Provider } from '../lib/types'
import ConfirmButton from './ConfirmButton'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const syncing = useStore((s) => s.syncing)
  const { saveSettings, syncNow, exportJson, importJson, wipe, showToast } = useStore.getState()

  const [provider, setProvider] = useState<Provider>(settings.provider)
  const [apiKey, setApiKey] = useState(settings.apiKey)
  const [apiUrl, setApiUrl] = useState(settings.apiUrl)
  const [model, setModel] = useState(settings.model)
  const [prompt, setPrompt] = useState(settings.prompt)
  const [syncUrl, setSyncUrl] = useState(
    settings.syncUrl || (settings.provider === 'local' && /https:/.test(settings.apiUrl) ? settings.apiUrl : ''),
  )
  const [syncId, setSyncId] = useState(settings.syncId)
  const fileRef = useRef<HTMLInputElement>(null)

  const changeProvider = (p: Provider) => {
    setProvider(p)
    const d = providerDefaults(p)
    setModel(d.model)
    setApiUrl(d.apiUrl)
  }

  const persist = () => {
    saveSettings({
      provider,
      apiKey: apiKey.trim(),
      apiUrl: apiUrl.trim() || providerDefaults(provider).apiUrl,
      model: model.trim() || providerDefaults(provider).model,
      prompt: prompt.trim() || defaultSettings().prompt,
      syncUrl: syncUrl.trim(),
      syncId: syncId.trim(),
    })
  }

  const doExport = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'pawcards-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    showToast('Backup exported')
  }
  const doImport = (input: HTMLInputElement) => {
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      try {
        const n = importJson(r.result as string)
        showToast(`Imported ${n} cards`)
        onClose()
      } catch (e) {
        showToast('Import failed: ' + (e as Error).message)
      }
    }
    r.readAsText(f)
  }
  const genSyncId = () => {
    const chunk = () => Math.random().toString(36).slice(2, 6)
    setSyncId('paw-' + chunk() + '-' + chunk() + '-' + chunk())
  }
  const manualSync = () => {
    persist()
    if (!syncConfigured({ syncUrl: syncUrl.trim(), syncId: syncId.trim() })) {
      showToast('Enter a sync URL and Sync ID first')
      return
    }
    void syncNow(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 text-[17px] font-bold">Settings</h2>
        <p className="hint mb-3.5">
          Everything is stored locally on this device. Use Export regularly to back up, or to move your cards to another device.
        </p>
        <div className="flex gap-2.5">
          <button className="btn btn-primary" onClick={doExport}>
            ⬇ Export backup
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            ⬆ Import
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => doImport(e.target)} />
        </div>

        <hr className="my-4.5 border-0 border-t border-line" />
        <h2 className="m-0 mb-1 text-[17px] font-bold">✨ AI image generation</h2>
        <p className="hint mb-3.5">
          Optional. ✨ turns your card's answer text into a front image, which you can then draw on top of.
          <br />
          <br />
          <b>Self-hosted (recommended, free):</b> point the endpoint at your own image server — a Cloudflare Worker running Workers AI (works
          from any device, incl. iPhone — free tier), or the Draw Things app on your Mac (API server on, port 7860).
          <br />
          <b>Gemini:</b> API key from aistudio.google.com/apikey; image generation needs pay-as-you-go billing.
          <br />
          <br />
          No API at all? Make an image in any app and import it with 📷 as the card background.
        </p>
        <div className="mb-3">
          <label className="field-label">Provider</label>
          <select className="field-input" value={provider} onChange={(e) => changeProvider(e.target.value as Provider)}>
            <option value="local">Self-hosted — Draw Things / Cloudflare Worker / A1111</option>
            <option value="gemini">Google Gemini / Nano Banana</option>
            <option value="openai">OpenAI-compatible (images edit)</option>
          </select>
        </div>
        {provider !== 'local' && (
          <div className="mb-3">
            <label className="field-label">API key</label>
            <input className="field-input" type="password" placeholder="paste key…" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
        )}
        {provider !== 'gemini' && (
          <div className="mb-3">
            <label className="field-label">Endpoint URL</label>
            <input className="field-input" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} />
          </div>
        )}
        {provider !== 'local' && (
          <div className="mb-3">
            <label className="field-label">Model</label>
            <input className="field-input" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
        )}
        <div className="mb-3">
          <label className="field-label">Polish style (what finished cards should look like)</label>
          <textarea className="field-input min-h-16 resize-y" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>

        <hr className="my-4.5 border-0 border-t border-line" />
        <h2 className="m-0 mb-1 text-[17px] font-bold">☁️ Cloud sync</h2>
        <p className="hint mb-3.5">
          Sync decks across your devices through your own Worker (KV storage, free tier). Enter the same Worker URL and Sync ID on every
          device — devices with the same ID share the same cards. <b>The Sync ID is the password to your cards: keep it secret</b>, and note
          cards are stored unencrypted in your Cloudflare account. Syncs automatically on open and shortly after edits.
        </p>
        <div className="mb-3">
          <label className="field-label">Sync server URL (your Worker, incl. ?key=)</label>
          <input className="field-input" placeholder="https://…workers.dev/?key=…" value={syncUrl} onChange={(e) => setSyncUrl(e.target.value)} />
        </div>
        <div className="mb-3">
          <label className="field-label">Sync ID (same on all your devices)</label>
          <input className="field-input" placeholder="tap New ID, or paste from your other device" value={syncId} onChange={(e) => setSyncId(e.target.value)} />
        </div>
        <div className="flex gap-2.5">
          <button className="btn" onClick={genSyncId}>
            🎲 New ID
          </button>
          <button className="btn btn-primary" disabled={syncing} onClick={manualSync} data-testid="sync-now">
            {syncing ? '⏳ Syncing…' : '☁ Sync now'}
          </button>
        </div>
        <p className="hint mt-2" data-testid="sync-status">
          {syncing
            ? 'Syncing with the cloud…'
            : settings.lastSyncAt
              ? 'Last synced: ' + new Date(settings.lastSyncAt).toLocaleString()
              : 'Never synced on this device.'}
        </p>

        <div className="mt-4 flex gap-2.5">
          <button
            className="btn btn-primary"
            onClick={() => {
              persist()
              onClose()
              showToast('Settings saved')
            }}
          >
            Save
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <hr className="my-4.5 border-0 border-t border-line" />
        <ConfirmButton
          className="btn btn-ghost text-again"
          label="Erase all data on this device"
          armedLabel="Tap again to erase EVERYTHING"
          toastMsg="Tap again to erase everything"
          onConfirm={() => {
            wipe()
            onClose()
            showToast('All data erased')
          }}
        />
        <p className="hint mt-3.5 text-center">PawCards v{APP_VERSION} 🐾</p>
      </div>
    </div>
  )
}
