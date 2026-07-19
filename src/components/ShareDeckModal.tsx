import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'
import { encodeShareQr, shareableCards, uploadDeckShare, type DeckShareQr } from '../lib/share'

/**
 * Share one deck with friends: uploads the deck (incl. images) to the user's
 * own Worker KV, then shows a QR pointing at it. Asks for a nickname on the
 * first ever share.
 */
export default function ShareDeckModal({ deckId, onClose }: { deckId: string; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const deck = useStore((s) => s.decks.find((d) => d.id === deckId))
  const allCards = useStore((s) => s.cards)
  const { saveSettings } = useStore.getState()

  const [nickname, setNickname] = useState(settings.nickname)
  const [phase, setPhase] = useState<'name' | 'uploading' | 'qr'>(settings.nickname ? 'uploading' : 'name')
  const [qr, setQr] = useState<DeckShareQr | null>(null)
  const [error, setError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const upload = async (by: string) => {
    setPhase('uploading')
    setError('')
    try {
      const cards = shareableCards(useStore.getState().cards, deckId)
      const payload = await uploadDeckShare(settings.syncUrl, by, deck!, cards)
      setQr(payload)
      setPhase('qr')
    } catch (e) {
      setError('Upload failed: ' + (e as Error).message)
      setPhase('name')
    }
  }

  // auto-start the upload when we already know the nickname
  const started = useRef(false)
  useEffect(() => {
    if (phase === 'uploading' && !started.current) {
      started.current = true
      void upload(settings.nickname)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== 'qr' || !qr || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, encodeShareQr(qr), { errorCorrectionLevel: 'M', width: 300, margin: 2 }).catch(
      (e: Error) => setError('Could not draw QR: ' + e.message),
    )
  }, [phase, qr])

  if (!deck) return null
  const deckCards = allCards.filter((c) => c.deckId === deckId)
  const count = shareableCards(allCards, deckId).length
  const heldBack = deckCards.length - count

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        {phase === 'name' && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">🤝 Share “{deck.name}”</h2>
            <p className="hint mb-3.5">
              What name should friends see on this deck?
              {heldBack > 0 && (
                <>
                  <br />
                  Sharing {count} of {deckCards.length} cards — {heldBack} kept private 🔒.
                </>
              )}
            </p>
            <input
              className="field-input"
              autoFocus
              placeholder="your nickname"
              value={nickname}
              maxLength={24}
              onChange={(e) => setNickname(e.target.value)}
              data-testid="share-nickname"
            />
            <div className="mt-3.5 flex gap-2.5">
              <button
                className="btn btn-primary"
                data-testid="share-upload"
                onClick={() => {
                  const by = nickname.trim()
                  if (!by) return
                  saveSettings({ nickname: by })
                  void upload(by)
                }}
              >
                ⬆ Upload &amp; show QR
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'uploading' && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">🤝 Share “{deck.name}”</h2>
            <p className="hint mb-3.5">⬆ Uploading {count} cards to your Worker…</p>
          </>
        )}

        {phase === 'qr' && qr && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">🤝 “{deck.name}” is ready to share</h2>
            <p className="hint mb-3.5">
              {heldBack > 0 && (
                <>
                  <b>
                    Sharing {count} of {deckCards.length} cards — {heldBack} kept private 🔒.
                  </b>
                  <br />
                </>
              )}
              Friends: open PawCards → tap 🤝 on the home screen → scan this code. The link expires after 60 days.
              Anyone with this code can also use your Worker, so share it within your group only.
            </p>
            <div className="flex justify-center">
              <canvas ref={canvasRef} className="rounded-lg" data-testid="share-qr-canvas" />
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
