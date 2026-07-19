import { useCallback, useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'
import {
  encodeRoomQr,
  fetchMembers,
  fetchRoom,
  fetchRoomDeck,
  fetchRoomDecks,
  shareDeckToRoom,
  type RoomDeckMeta,
  type RoomMember,
} from '../lib/room'
import ConfirmButton from './ConfirmButton'

/**
 * Inside a room: members, everyone's shared decks (import what you like),
 * invite QR, share-your-deck picker. Content is fetched from the room
 * creator's worker; ↻ refreshes.
 */
export default function RoomView() {
  const code = useStore((s) => s.curRoomCode)!
  const ref = useStore((s) => s.rooms.find((r) => r.code === code))
  const myDecks = useStore((s) => s.decks)
  const settings = useStore((s) => s.settings)
  const { go, leaveRoom, importSharedDeck, showToast, openDeck } = useStore.getState()

  const [host, setHost] = useState('')
  const [members, setMembers] = useState<RoomMember[]>([])
  const [decks, setDecks] = useState<RoomDeckMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [invite, setInvite] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busyDeck, setBusyDeck] = useState('')

  const load = useCallback(async () => {
    if (!ref) return
    setLoading(true)
    setError('')
    try {
      const [room, mem, dks] = await Promise.all([
        fetchRoom(ref.url, ref.code),
        fetchMembers(ref.url, ref.code),
        fetchRoomDecks(ref.url, ref.code),
      ])
      setHost(room.host)
      setMembers(mem)
      setDecks(dks)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [ref])

  useEffect(() => {
    void load()
  }, [load])

  if (!ref) return null

  const doImport = async (meta: RoomDeckMeta) => {
    setBusyDeck(meta.deckId)
    try {
      const share = await fetchRoomDeck(ref.url, meta)
      const n = importSharedDeck(share)
      showToast(`🤝 Imported “${share.deck.name}” — ${n} cards from ${share.by}`)
    } catch (e) {
      showToast('Import failed: ' + (e as Error).message)
    } finally {
      setBusyDeck('')
    }
  }

  const doShare = async (deckId: string) => {
    const deck = myDecks.find((d) => d.id === deckId)
    if (!deck) return
    setPicking(false)
    setBusyDeck(deckId)
    try {
      const cards = useStore.getState().cards.filter((c) => c.deckId === deckId)
      await shareDeckToRoom(ref.url, ref.code, settings.nickname || 'me', deck, cards)
      showToast(`🤝 “${deck.name}” shared into the room`)
      await load()
    } catch (e) {
      showToast('Share failed: ' + (e as Error).message)
    } finally {
      setBusyDeck('')
    }
  }

  const imported = (meta: RoomDeckMeta) => myDecks.some((d) => d.id === meta.deckId)
  const shareable = myDecks.filter((d) => !d.sharedBy)

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button className="iconbtn" onClick={() => go('home')}>
          ‹
        </button>
        <h1 className="m-0 flex-1 truncate text-[19px] font-bold tracking-tight">🏫 {ref.name}</h1>
        <button className="iconbtn" title="Refresh" onClick={() => void load()}>
          ↻
        </button>
        <button className="btn" data-testid="room-invite" onClick={() => setInvite(true)}>
          ▦ Invite
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <p className="hint mb-3" data-testid="room-members">
          {loading
            ? 'Loading the room…'
            : members.length
              ? `Here: ${members.map((m) => m.name).join(', ')}${host ? ` · hosted by ${host}` : ''}`
              : 'Nobody here yet — invite your friends!'}
        </p>
        {error && <p className="hint mb-3 text-again">{error}</p>}

        <div className="mb-3.5 flex gap-2.5">
          <button className="btn btn-primary" data-testid="room-share-deck" onClick={() => setPicking(true)}>
            🤝 Share a deck
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          {!loading && decks.length === 0 && (
            <div className="py-10 text-center text-sm text-muted">No decks shared yet — be the first! 🐾</div>
          )}
          {decks.map((m) => (
            <div key={m.deckId} className="flex items-center gap-3 rounded-xl border border-line bg-panel p-3.5 shadow-soft" data-testid={'room-deck-' + m.deckId}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-bold">{m.name}</div>
                <div className="text-xs text-muted">
                  {m.count} card{m.count === 1 ? '' : 's'} · by {m.by}
                </div>
              </div>
              {imported(m) ? (
                <button className="btn" onClick={() => openDeck(m.deckId)}>
                  ✓ In library
                </button>
              ) : (
                <button className="btn btn-primary" disabled={busyDeck === m.deckId} data-testid={'room-import-' + m.deckId} onClick={() => void doImport(m)}>
                  {busyDeck === m.deckId ? '⏳' : '⬇ Import'}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="mt-6">
          <ConfirmButton
            className="btn btn-ghost text-again"
            label="Leave room"
            armedLabel="Tap again to leave"
            toastMsg="Leaving removes the room from your library — decks you imported stay"
            onConfirm={() => leaveRoom(code)}
          />
        </div>
      </main>

      {invite && <InviteModal name={ref.name} url={ref.url} code={ref.code} onClose={() => setInvite(false)} />}

      {picking && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && setPicking(false)}>
          <div className="max-h-[70dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <h2 className="m-0 mb-1 text-[17px] font-bold">🤝 Share which deck?</h2>
            <p className="hint mb-3.5">The deck (with images) uploads to the room. Re-sharing later updates it for everyone.</p>
            <div className="flex flex-col gap-2">
              {shareable.length === 0 && <p className="hint">No decks of your own yet.</p>}
              {shareable.map((d) => (
                <button key={d.id} className="btn justify-start" data-testid={'pick-deck-' + d.id} onClick={() => void doShare(d.id)}>
                  {d.name}
                </button>
              ))}
            </div>
            <button className="btn btn-ghost mt-4" onClick={() => setPicking(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function InviteModal({ name, url, code, onClose }: { name: string; url: string; code: string; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, encodeRoomQr({ url, code, name }), { errorCorrectionLevel: 'M', width: 300, margin: 2 }).catch(
      (e: Error) => setError('Could not draw QR: ' + e.message),
    )
  }, [url, code, name])
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 text-[17px] font-bold">▦ Invite to “{name}”</h2>
        <p className="hint mb-3.5">
          Friends: PawCards → 🏫 Rooms → 📷 Join → scan this. Anyone with this code can use the room's worker, so keep
          it within your group.
        </p>
        <div className="flex justify-center">
          <canvas ref={canvasRef} className="rounded-lg" data-testid="room-qr-canvas" />
        </div>
        {error && <p className="hint mt-3 text-again">{error}</p>}
        <button className="btn btn-ghost mt-4" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
