import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { useStore } from '../store'
import { expiresLabel, fetchRoomDeck, ROOM_PROTO, shareDeckToRoom, unshareDeckFromRoom, useRoom, type RoomDeckMeta } from '../lib/room'
import { encodeInvite, inviteLink, type InvitePayload } from '../lib/invite'
import { urlWithTempKey } from '../lib/tempkey'
import { shareableCards, type ShareDoc } from '../lib/share'
import ConfirmButton from './ConfirmButton'
import QrShareButton from './QrShareButton'
import RoomReview from './RoomReview'
import Icon from './Icon'

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
  const [showStart, setShowStart] = useState(false)
  const [count, setCount] = useState(20)
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
      const cards = shareableCards(useStore.getState().cards, deckId)
      await shareDeckToRoom(ref.url, settings.nickname || 'me', deck, cards, send)
      const held = useStore.getState().cards.filter((c) => c.deckId === deckId && c.private).length
      showToast(`🤝 “${deck.name}” shared into the room` + (held ? ` (${held} kept private 🔒)` : ''))
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
      // draw the host-chosen number of cards (0 = all) from the shuffled pool
      const wanted = count > 0 ? Math.min(count, refs.length) : refs.length
      useStore.getState().saveSettings({ roomReviewCount: count })
      setShowStart(false)
      send({ type: 'start-review', queue: refs.slice(0, wanted) })
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
  const totalShared = decks.reduce((s, d) => s + d.count, 0)

  const openStart = () => {
    const pref = settings.roomReviewCount || totalShared
    setCount(Math.max(1, Math.min(pref, totalShared)))
    setShowStart(true)
  }

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button className="iconbtn" data-testid="back" title="Back" onClick={() => go('home')}>
          <Icon name="back" size={22} />
        </button>
        <h1 className="m-0 flex flex-1 items-center gap-1.5 truncate text-[19px] font-bold tracking-tight">
          <Icon name="room" size={18} /> <span className="truncate">{ref.name}</span>
        </h1>
        <button className="btn" data-testid="room-invite" onClick={() => setInvite(true)}>
          <Icon name="qr" size={16} /> Invite
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
        {(state?.expiresAt || ref.expiresAt) ? (
          <p className="hint mb-3" data-testid="room-expiry">
            ⏳ Room expires {new Date(state?.expiresAt || ref.expiresAt!).toLocaleDateString()} ({expiresLabel(state?.expiresAt || ref.expiresAt!)})
          </p>
        ) : null}
        {status === 'live' && state && (state.proto ?? 0) < ROOM_PROTO && (
          <p className="hint mb-3 text-again" data-testid="room-proto-warning">
            ⚠ This room's worker is older than your app — group review and unshare won't work until the room creator
            redeploys it (<b>bun worker/cli.ts &lt;name&gt; deploy</b>).
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
            <Icon name="share" size={16} /> Share a deck
          </button>
          {!review && decks.length > 0 && (
            <button className="btn btn-accent" data-testid="room-review-start" disabled={status !== 'live' || starting} onClick={openStart}>
              <Icon name="play" size={16} /> Start group review
            </button>
          )}
        </div>

        {review && !inReview && (
          <div className="mb-3.5 flex items-center gap-3 rounded-[14px] bg-ink p-3.5 text-white shadow-soft">
            <div className="min-w-0 flex-1 text-sm font-semibold">
              <span className="flex items-center gap-1.5">
                <Icon name="play" size={15} /> Group review in progress — hosted by {review.hostName}
              </span>
              <div className="text-xs font-normal opacity-75">
                card {review.i + 1} of {review.queue.length}
              </div>
            </div>
            <button className="btn btn-accent" data-testid="room-review-join" onClick={() => setInReview(true)}>
              <Icon name="play" size={15} /> Join
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
                    <Icon name="refresh" size={15} className={busyDeck === m.deckId ? 'animate-spin' : ''} /> Re-share
                  </button>
                  <ConfirmButton
                    className="btn text-again"
                    testId={'room-unshare-' + m.deckId}
                    label={<Icon name="close" />}
                    armedLabel={<Icon name="close" size={20} strokeWidth={2.6} />}
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
                    <Icon name="refresh" size={15} className={busyDeck === m.deckId ? 'animate-spin' : ''} /> Update
                  </button>
                  <button className="btn" onClick={() => openDeck(m.deckId)}>
                    Open
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" disabled={busyDeck === m.deckId} data-testid={'room-import-' + m.deckId} onClick={() => void doImport(m)}>
                  <Icon name="import" size={15} className={busyDeck === m.deckId ? 'animate-spin' : ''} /> Import
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

      {invite && (
        <InviteModal
          payload={{
            url: ref.url,
            code: ref.code,
            name: ref.name,
            by: ref.by || settings.nickname || undefined,
            exp: ref.expiresAt,
          }}
          onClose={() => setInvite(false)}
        />
      )}

      {showStart && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && setShowStart(false)}>
          <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
              <Icon name="play" size={17} /> Start group review
            </h2>
            <p className="hint mb-3.5">
              Randomly draw cards from the {totalShared} shared card{totalShared === 1 ? '' : 's'} across {decks.length}{' '}
              deck{decks.length === 1 ? '' : 's'}. Everyone follows your lead; grading stays private.
            </p>
            <label className="field-label">How many cards?</label>
            <div className="mb-4 rounded-xl border border-line bg-paper p-4">
              <div className="mb-3 text-center">
                <span className="text-[32px] font-extrabold leading-none text-ink" data-testid="rr-count-value">
                  {count}
                </span>
                <span className="ml-1.5 text-sm text-muted">of {totalShared} cards</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  className="iconbtn shrink-0 text-lg"
                  data-testid="rr-count-dec"
                  aria-label="One fewer"
                  onClick={() => setCount((c) => Math.max(1, c - 1))}
                >
                  <Icon name="minus" size={18} strokeWidth={2.4} />
                </button>
                <input
                  className="h-2 flex-1 cursor-pointer"
                  style={{ accentColor: 'var(--color-accent)' }}
                  type="range"
                  min={1}
                  max={totalShared}
                  step={1}
                  value={count}
                  data-testid="rr-count-input"
                  onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
                />
                <button
                  className="iconbtn shrink-0 text-lg"
                  data-testid="rr-count-inc"
                  aria-label="One more"
                  onClick={() => setCount((c) => Math.min(totalShared, c + 1))}
                >
                  <Icon name="plus" size={18} strokeWidth={2.4} />
                </button>
              </div>
              <button
                className={'btn mt-3 w-full justify-center ' + (count >= totalShared ? 'btn-primary' : '')}
                data-testid="rr-count-all"
                onClick={() => setCount(totalShared)}
              >
                All {totalShared} cards
              </button>
            </div>
            <div className="flex gap-2.5">
              <button className="btn btn-accent" data-testid="rr-start-go" disabled={starting} onClick={() => void startGroupReview()}>
                <Icon name="play" size={16} className={starting ? 'animate-spin' : ''} /> {starting ? 'Starting…' : 'Start'}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowStart(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && setPicking(false)}>
          <div className="max-h-[70dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
              <Icon name="share" size={17} /> Share which deck?
            </h2>
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

/** invites carry a TEMP key valid until the room's expiry (60d default) —
 *  your root key never enters the QR/link. An attendee whose url already
 *  holds a temp key reshares it as-is (only root holders can mint). */
const INVITE_DEFAULT_MS = 60 * 24 * 60 * 60 * 1000

function InviteModal({ payload, onClose }: { payload: InvitePayload; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { showToast } = useStore.getState()
  const [error, setError] = useState('')
  const [inv, setInv] = useState<InvitePayload | null>(null)
  const name = payload.name ?? 'Room'

  useEffect(() => {
    let gone = false
    const exp = payload.exp ?? Date.now() + INVITE_DEFAULT_MS
    urlWithTempKey(payload.url, exp)
      .then((url) => {
        if (!gone) setInv({ ...payload, url, exp })
      })
      .catch(() => {
        if (!gone) setError('Could not prepare the invite key')
      })
    return () => {
      gone = true
    }
    // payload is built fresh by the caller each open — key on its stable parts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.url, payload.code, payload.name, payload.by, payload.exp])

  useEffect(() => {
    if (!inv || !canvasRef.current) return
    QRCode.toCanvas(canvasRef.current, encodeInvite(inv), { errorCorrectionLevel: 'M', width: 300, margin: 2 }).catch(
      (e: Error) => setError('Could not draw QR: ' + e.message),
    )
  }, [inv])

  const inviteDays = inv?.exp ? Math.max(0, Math.ceil((inv.exp - Date.now()) / (24 * 60 * 60 * 1000))) : null

  const copyLink = async () => {
    if (!inv) return
    const link = inviteLink(location.origin, inv)
    try {
      await navigator.clipboard.writeText(link)
      showToast('🔗 Invite link copied — paste it into your group chat')
    } catch {
      showToast('Could not copy — long-press the QR instead')
    }
  }

  const shareLink = async () => {
    if (!inv) return
    const link = inviteLink(location.origin, inv)
    try {
      await navigator.share({ title: `Join my PawCards room: ${name}`, url: link })
    } catch {
      /* user cancelled the share sheet — nothing to do */
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
          <Icon name="qr" size={17} /> Invite to “{name}”
        </h2>
        <p className="hint mb-3.5">
          Send friends the link, or have them scan this code in PawCards (Rooms → Join). New friends get set up
          automatically.{inviteDays !== null ? (inviteDays <= 0 ? ' Expires today.' : ` Expires in ${inviteDays} day${inviteDays === 1 ? '' : 's'}.`) : ''}
        </p>
        <div className="flex flex-col items-center">
          {!inv && !error && <p className="hint py-10">Preparing invite…</p>}
          <canvas ref={canvasRef} className={'rounded-lg' + (inv ? '' : ' hidden')} data-testid="room-qr-canvas" />
          {inv && (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2.5">
              {typeof navigator.share === 'function' && (
                <button className="btn" data-testid="room-share-link" onClick={() => void shareLink()}>
                  <Icon name="share" size={15} /> Share link
                </button>
              )}
              <button className="btn" data-testid="room-copy-link" onClick={() => void copyLink()}>
                <Icon name="link" size={15} /> Copy link
              </button>
              <QrShareButton className="" canvasRef={canvasRef} filename={`pawcards-room-${name}.png`} title={`Join my PawCards room: ${name}`} />
            </div>
          )}
        </div>
        {error && <p className="hint mt-3 text-again">{error}</p>}
        <button className="btn btn-ghost mt-4" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
