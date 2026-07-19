import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'
import { encodeRoomQr, fetchRoomDeck, ROOM_PROTO, shareDeckToRoom, unshareDeckFromRoom, useRoom, type RoomDeckMeta } from '../lib/room'
import type { ShareDoc } from '../lib/share'
import ConfirmButton from './ConfirmButton'
import RoomReview from './RoomReview'

/**
 * Inside a room — live over a WebSocket to the room's Durable Object.
 * Presence, shared decks, and (later) group review all push in real time;
 * there is nothing to manually refresh.
 */
export default function RoomView() {
  const code = useStore((s) => s.curRoomCode)!
  const ref = useStore((s) => s.rooms.find((r) => r.code === code))
  const myDecks = useStore((s) => s.decks)
  const settings = useStore((s) => s.settings)
  const { go, leaveRoom, importSharedDeck, showToast, openDeck } = useStore.getState()

  const { state, status, send } = useRoom(ref, settings.nickname)
  const [invite, setInvite] = useState(false)
  const [picking, setPicking] = useState(false)
  const [busyDeck, setBusyDeck] = useState('')
  const [inReview, setInReview] = useState(false)
  const [starting, setStarting] = useState(false)
  /** deckId → fetched payload; shared with the review so nothing downloads twice */
  const cacheRef = useRef(new Map<string, ShareDoc>())

  const review = state?.review ?? null
  // the host finishing (or ending) the session returns everyone to the room.
  // sawReview guards the start-up race: right after "start", inReview is true
  // but the DO's broadcast with the review hasn't arrived yet.
  const sawReview = useRef(false)
  useEffect(() => {
    if (inReview && review) sawReview.current = true
    if (inReview && !review && sawReview.current) {
      sawReview.current = false
      setInReview(false)
      useStore.getState().showToast('Group review finished 🎉')
    }
  }, [inReview, review])

  if (!ref) return null

  const doImport = async (meta: RoomDeckMeta, updating = false) => {
    setBusyDeck(meta.deckId)
    try {
      const share = await fetchRoomDeck(ref.url, meta)
      const n = importSharedDeck(share)
      showToast(
        updating
          ? `↻ “${share.deck.name}” updated from ${share.by} — now ${n} cards`
          : `🤝 Imported “${share.deck.name}” — ${n} cards from ${share.by}`,
      )
    } catch (e) {
      showToast((updating ? 'Update' : 'Import') + ' failed: ' + (e as Error).message)
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
      await shareDeckToRoom(ref.url, settings.nickname || 'me', deck, cards, send)
      showToast(`🤝 “${deck.name}” shared into the room`)
    } catch (e) {
      showToast('Share failed: ' + (e as Error).message)
    } finally {
      setBusyDeck('')
    }
  }

  /** host flow: fetch every shared deck, build one shuffled queue, announce it */
  const startGroupReview = async () => {
    setStarting(true)
    try {
      const refs: { deckId: string; cardId: string }[] = []
      for (const m of state?.decks ?? []) {
        let doc = cacheRef.current.get(m.deckId)
        if (!doc) {
          doc = await fetchRoomDeck(ref.url, m)
          cacheRef.current.set(m.deckId, doc)
        }
        for (const c of doc.cards) refs.push({ deckId: m.deckId, cardId: c.id })
      }
      if (!refs.length) {
        showToast('The shared decks have no cards yet')
        return
      }
      for (let i = refs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[refs[i], refs[j]] = [refs[j], refs[i]]
      }
      send({ type: 'start-review', queue: refs })
      setInReview(true)
    } catch (e) {
      showToast('Could not start: ' + (e as Error).message)
    } finally {
      setStarting(false)
    }
  }

  /** shared by me (from this room membership) — I can re-share and unshare */
  const mine = (meta: RoomDeckMeta) => meta.memberId === ref.memberId
  const imported = (meta: RoomDeckMeta) => myDecks.some((d) => d.id === meta.deckId)
  const shareable = myDecks.filter((d) => !d.sharedBy)
  const decks = state?.decks ?? []

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button className="iconbtn" onClick={() => go('home')}>
          ‹
        </button>
        <h1 className="m-0 flex-1 truncate text-[19px] font-bold tracking-tight">🏫 {ref.name}</h1>
        <button className="btn" data-testid="room-invite" onClick={() => setInvite(true)}>
          ▦ Invite
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <p className="hint mb-3" data-testid="room-members">
          {status === 'live' && state
            ? `🟢 Here: ${state.members.map((m) => m.name).join(', ') || 'just you'}${state.host ? ` · hosted by ${state.host}` : ''}`
            : status === 'connecting'
              ? '⏳ Connecting to the room…'
              : ''}
        </p>
        {status === 'live' && state && (state.proto ?? 0) < ROOM_PROTO && (
          <p className="hint mb-3 text-again" data-testid="room-proto-warning">
            ⚠ This room's worker is older than your app — group review and unshare won't work until the room creator
            redeploys it (<b>bun worker/deploy.ts</b>).
          </p>
        )}
        {status === 'error' && (
          <p className="hint mb-3 text-again" data-testid="room-error">
            Can't reach this room. Make sure you're online and the room's worker is deployed with room support
            (worker/pawcards-worker.js + wrangler.toml Durable Object blocks). Retrying…
          </p>
        )}

        <div className="mb-3.5 flex flex-wrap gap-2.5">
          <button className="btn btn-primary" data-testid="room-share-deck" disabled={status !== 'live'} onClick={() => setPicking(true)}>
            🤝 Share a deck
          </button>
          {!review && decks.length > 0 && (
            <button className="btn btn-accent" data-testid="room-review-start" disabled={status !== 'live' || starting} onClick={() => void startGroupReview()}>
              {starting ? '⏳ Starting…' : '🎬 Start group review'}
            </button>
          )}
        </div>

        {review && !inReview && (
          <div className="mb-3.5 flex items-center gap-3 rounded-[14px] bg-ink p-3.5 text-white shadow-soft">
            <div className="min-w-0 flex-1 text-sm font-semibold">
              🎬 Group review in progress — hosted by {review.hostName}
              <div className="text-xs font-normal opacity-75">
                card {review.i + 1} of {review.queue.length}
              </div>
            </div>
            <button className="btn btn-accent" data-testid="room-review-join" onClick={() => setInReview(true)}>
              ▶ Join
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          {status === 'live' && decks.length === 0 && (
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
              {mine(m) ? (
                <>
                  <button
                    className="btn"
                    title="Upload the current cards again — friends can then tap Update"
                    disabled={busyDeck === m.deckId}
                    data-testid={'room-reshare-' + m.deckId}
                    onClick={() => void doShare(m.deckId)}
                  >
                    {busyDeck === m.deckId ? '⏳' : '↻ Re-share'}
                  </button>
                  <ConfirmButton
                    className="btn text-again"
                    label="✕"
                    armedLabel="✕ Sure?"
                    title="Remove this deck from the room"
                    toastMsg="Tap again to remove it from the room — friends keep what they already imported"
                    onConfirm={() => unshareDeckFromRoom(m.deckId, send)}
                  />
                </>
              ) : imported(m) ? (
                <>
                  <button
                    className="btn"
                    title="Fetch the sharer's latest version into your copy"
                    disabled={busyDeck === m.deckId}
                    data-testid={'room-update-' + m.deckId}
                    onClick={() => void doImport(m, true)}
                  >
                    {busyDeck === m.deckId ? '⏳' : '↻ Update'}
                  </button>
                  <button className="btn" onClick={() => openDeck(m.deckId)}>
                    Open
                  </button>
                </>
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

      {inReview && review && state && (
        <RoomReview roomRef={ref} state={state} review={review} cache={cacheRef.current} send={send} onExit={() => setInReview(false)} />
      )}

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
