import { useState } from 'react'
import { useStore } from '../store'
import { fetchSharedDeck, parseShareQr, type DeckShareQr, type ShareDoc } from '../lib/share'
import QrScanner from './QrScanner'
import Icon from './Icon'

/** Scan a friend's deck-share QR, preview it, and import it into the library. */
export default function ImportShareModal({ onClose }: { onClose: () => void }) {
  const { importSharedDeck, showToast, openDeck } = useStore.getState()
  const [error, setError] = useState('')
  const [qr, setQr] = useState<DeckShareQr | null>(null)
  const [share, setShare] = useState<ShareDoc | null>(null)
  const [fetching, setFetching] = useState(false)

  const onCode = (text: string) => {
    try {
      const p = parseShareQr(text)
      setQr(p)
      setError('')
      setFetching(true)
      void fetchSharedDeck(p)
        .then((doc) => setShare(doc))
        .catch((e: Error) => setError(e.message))
        .finally(() => setFetching(false))
      return true
    } catch (e) {
      setError((e as Error).message) // wrong QR — keep scanning
      return false
    }
  }

  const doImport = () => {
    if (!share) return
    const n = importSharedDeck(share)
    showToast(`🤝 Imported “${share.deck.name}” — ${n} cards from ${share.by}`)
    onClose()
    openDeck(share.deck.id)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        {!qr && (
          <>
            <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold"><Icon name="share" size={17} /> Import a shared deck</h2>
            <p className="hint mb-3.5">
              Point the camera at a friend's deck QR (they tap 🤝 Share inside their deck) — or pick a saved QR image.
            </p>
            <QrScanner active={!qr} onCode={onCode} />
          </>
        )}

        {qr && (fetching || (!share && !error)) && (
          <>
            <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold"><Icon name="share" size={17} /> “{qr.name}”</h2>
            <p className="hint mb-3.5">Fetching the deck from {qr.by}…</p>
          </>
        )}

        {share && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">Import this deck?</h2>
            <div className="mb-3.5 rounded-lg border border-line p-3 text-[14px] leading-relaxed" data-testid="import-summary">
              <div>
                <b>Deck:</b> {share.deck.name}
              </div>
              <div>
                <b>Cards:</b> {share.cards.length}
              </div>
              <div>
                <b>Shared by:</b> {share.by}
              </div>
            </div>
            <p className="hint mb-3.5">It joins your library with a 🤝 tag; reviews and scheduling stay private to you.</p>
            <div className="flex gap-2.5">
              <button className="btn btn-primary" data-testid="import-go" onClick={doImport}>
                <Icon name="import" size={16} /> Import deck
              </button>
              <button
                className="btn"
                onClick={() => {
                  setQr(null)
                  setShare(null)
                  setError('')
                }}
              >
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
