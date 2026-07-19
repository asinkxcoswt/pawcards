import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { encodeConfig, parseConfig, type ConfigPayload } from '../lib/qrconfig'
import QrScanner from './QrScanner'
import QrShareButton from './QrShareButton'

interface Props {
  mode: 'show' | 'scan'
  /** show mode: 'device' = full config, 'friend' = Sync ID already blanked by the caller */
  variant?: 'device' | 'friend'
  /** current form values (show mode encodes these, incl. unsaved edits) */
  config: ConfigPayload
  onApply: (cfg: ConfigPayload) => void
  onClose: () => void
}

const mask = (v: string) => (v.length > 8 ? v.slice(0, 4) + '…' + v.slice(-4) : v || '—')
const host = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url || '—'
  }
}

export default function QrConfigModal({ mode, variant = 'device', config, onApply, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const [scanned, setScanned] = useState<ConfigPayload | null>(null)

  // show mode: draw the QR
  useEffect(() => {
    if (mode !== 'show' || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, encodeConfig(config), {
      errorCorrectionLevel: 'M',
      width: 300,
      margin: 2,
    }).catch((e: Error) => setError('Could not draw QR: ' + e.message))
  }, [mode, config])

  // scan mode: camera or picked image, until a valid payload is found
  const onCode = (text: string) => {
    try {
      setScanned(parseConfig(text))
      setError('')
      return true
    } catch (e) {
      setError((e as Error).message) // wrong QR — keep scanning
      return false
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(30,25,18,.5)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
      >
        {mode === 'show' && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">
              {variant === 'friend' ? '🤝 Settings QR for a friend' : '▦ Settings QR'}
            </h2>
            <p className="hint mb-3.5">
              {variant === 'friend' ? (
                <>
                  On their device: open PawCards → Settings → <b>📷 Scan settings QR</b>. Your Sync ID is left out, so
                  their cards stay separate from yours — but the code still contains your API key / worker URL, so only
                  share with someone you trust.
                </>
              ) : (
                <>
                  On your other device open PawCards → Settings → <b>📷 Scan settings QR</b> and point it here. This
                  code contains your API key and Sync ID — don't show it to anyone else.
                </>
              )}
            </p>
            <div className="flex flex-col items-center">
              <canvas ref={canvasRef} className="rounded-lg" data-testid="qr-canvas" />
              <QrShareButton canvasRef={canvasRef} filename="pawcards-settings-qr.png" title="PawCards settings" />
            </div>
          </>
        )}

        {mode === 'scan' && !scanned && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">📷 Scan settings QR</h2>
            <p className="hint mb-3.5">
              On your other device open Settings → <b>▦ Show settings QR</b>, then point this camera at it — or pick a
              saved QR image (e.g. the deploy script's settings card).
            </p>
            <QrScanner active={mode === 'scan' && !scanned} onCode={onCode} />
          </>
        )}

        {mode === 'scan' && scanned && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">Apply these settings?</h2>
            <p className="hint mb-3.5">This replaces the AI image and cloud sync configuration on this device. Your cards are not affected.</p>
            <div className="mb-3.5 rounded-lg border border-line p-3 text-[14px] leading-relaxed" data-testid="qr-summary">
              <div>
                <b>Provider:</b> {scanned.provider}
                {scanned.model ? ` · ${scanned.model}` : ''}
              </div>
              <div>
                <b>API key:</b> {mask(scanned.apiKey)}
              </div>
              <div>
                <b>Endpoint:</b> {host(scanned.apiUrl)}
              </div>
              <div>
                <b>Sync server:</b> {host(scanned.syncUrl)}
              </div>
              <div>
                <b>Sync ID:</b> {scanned.syncId || 'not included — this device keeps its own'}
              </div>
            </div>
            <div className="flex gap-2.5">
              <button className="btn btn-primary" data-testid="qr-apply" onClick={() => onApply(scanned)}>
                ✓ Apply settings
              </button>
              <button className="btn" onClick={() => setScanned(null)}>
                ↻ Rescan
              </button>
            </div>
          </>
        )}

        {error && <p className="hint mt-3 text-again">{error}</p>}

        <button className="btn btn-ghost mt-4" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
