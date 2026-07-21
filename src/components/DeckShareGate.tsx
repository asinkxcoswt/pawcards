import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { fetchSharedDeck, type DeckShareQr, type ShareDoc } from '../lib/share'
import Icon from './Icon'
import Logo from './Logo'

/**
 * Handles a deck-share link (#deck= fragment) on boot. Deliberately simpler
 * than the room invite: it NEVER changes the receiver's settings (even a brand
 * new user stays unconfigured) — it just fetches the one shared deck (via the
 * scoped token baked into the link) and saves it to the local library.
 */
export default function DeckShareGate({ qr }: { qr: DeckShareQr }) {
  const { importSharedDeck, showToast, openDeck } = useStore.getState()
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error' | 'closed'>('loading')
  const [share, setShare] = useState<ShareDoc | null>(null)
  const [error, setError] = useState('')
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    fetchSharedDeck(qr)
      .then((doc) => {
        setShare(doc)
        setPhase('ready')
      })
      .catch((e: Error) => {
        setError(e.message)
        setPhase('error')
      })
  }, [qr])

  if (phase === 'closed') return null

  const doImport = () => {
    if (!share) return
    const n = importSharedDeck(share)
    setPhase('closed')
    showToast(`Imported “${share.deck.name}” — ${n} cards from ${share.by}`)
    openDeck(share.deck.id)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,25,18,.5)] p-4">
      <div className="w-full max-w-[420px] rounded-[20px] bg-panel p-5 shadow-soft" data-testid="deck-share-gate">
        <div className="mb-2 flex justify-center">
          <Logo className="h-9" />
        </div>

        {phase === 'loading' && (
          <>
            <h2 className="m-0 mb-1 text-center text-[19px] font-bold">Getting the deck…</h2>
            <p className="hint mb-1 text-center">Downloading “{qr.name}” from {qr.by}.</p>
          </>
        )}

        {phase === 'ready' && share && (
          <>
            <h2 className="m-0 mb-1 text-center text-[19px] font-bold">Save “{share.deck.name}”?</h2>
            <p className="hint mb-4 text-center">
              {share.cards.length} card{share.cards.length === 1 ? '' : 's'} from {share.by}. It's added to your decks
              on this device.
            </p>
            <div className="flex flex-col gap-2">
              <button className="btn btn-primary justify-center" data-testid="deck-share-save" onClick={doImport}>
                <Icon name="import" size={16} /> Save to my decks
              </button>
              <button className="btn btn-ghost" data-testid="deck-share-skip" onClick={() => setPhase('closed')}>
                Skip
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <h2 className="m-0 mb-1 text-center text-[19px] font-bold">This deck link didn't work</h2>
            <p className="hint mb-4 text-center">
              It may have expired (deck links last 60 days) or you're offline. Ask {qr.by} for a fresh one.
            </p>
            {error && <p className="hint mb-3 text-center text-[12px] text-again">{error}</p>}
            <button className="btn btn-ghost w-full justify-center" data-testid="deck-share-close" onClick={() => setPhase('closed')}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}
