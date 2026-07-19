import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { fmtIv, previewIntervals } from '../lib/srs'
import { fontSizeTier, paintCard } from '../lib/canvas'
import { CARD_W } from '../lib/constants'
import { fetchRoomDeck, type RoomReviewState, type RoomState } from '../lib/room'
import type { ShareDoc } from '../lib/share'
import type { Card, Grade, RoomRef } from '../lib/types'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

interface Props {
  roomRef: RoomRef
  state: RoomState
  review: RoomReviewState
  /** deckId → fetched payload, shared with RoomView so nothing downloads twice */
  cache: Map<string, ShareDoc>
  send: (msg: object) => void
  onExit: () => void
}

/**
 * Group review — everyone sees the host's current card live. The host
 * reveals and advances; each participant grades PRIVATELY into their own
 * copy. Grading a not-yet-imported deck imports it implicitly (except Easy).
 */
export default function RoomReview({ roomRef, state, review, cache, send, onExit }: Props) {
  const myCards = useStore((s) => s.cards)
  const myDecks = useStore((s) => s.decks)
  const { gradeCard, importSharedDeck, showToast } = useStore.getState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardWrapRef = useRef<HTMLDivElement>(null)
  const [, setCacheTick] = useState(0)
  const [gradedAt, setGradedAt] = useState(-1)

  const isHost = review.hostMemberId === roomRef.memberId
  const cur = review.queue[review.i]
  const meta = state.decks.find((d) => d.deckId === cur?.deckId)
  const localCard = cur ? myCards.find((c) => c.id === cur.cardId) : undefined
  const card: Card | undefined = localCard ?? (cur ? cache.get(cur.deckId)?.cards.find((c) => c.id === cur.cardId) : undefined)
  const side: 'front' | 'back' = review.flipped ? 'back' : 'front'
  const showDomText = side === 'back' && !!card?.backText.trim()

  // lazy-fetch the payload of a deck we haven't imported (for display)
  const deckId = cur?.deckId
  useEffect(() => {
    if (!deckId || !meta || localCard || cache.has(deckId)) return
    let dead = false
    fetchRoomDeck(roomRef.url, meta)
      .then((doc) => {
        if (dead) return
        cache.set(deckId, doc)
        setCacheTick((t) => t + 1)
      })
      .catch((e: Error) => showToast('Could not fetch the deck: ' + e.message))
    return () => {
      dead = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, !!localCard])

  useEffect(() => {
    const cv = canvasRef.current
    const wrap = cardWrapRef.current
    if (!cv || !wrap || !card) return
    paintCard(cv, card, side, wrap.clientWidth, { skipBackText: true })
  }, [card, side])

  if (!cur) return null

  const doGrade = (g: Grade) => {
    if (gradedAt === review.i) return
    const haveDeck = myDecks.some((d) => d.id === cur.deckId)
    if (!haveDeck) {
      if (g === 3) {
        setGradedAt(review.i)
        showToast('Easy — deck not imported, so nothing to track 👍')
        return
      }
      const doc = cache.get(cur.deckId)
      if (!doc) {
        showToast('Still fetching this deck — one moment…')
        return
      }
      importSharedDeck(doc)
      showToast(`🤝 Imported “${doc.deck.name}” to track your progress`)
    }
    gradeCard(cur.cardId, g)
    setGradedAt(review.i)
  }

  const iv = localCard ? previewIntervals(localCard) : null
  const textPx = cardWrapRef.current && card ? Math.round((cardWrapRef.current.clientWidth * fontSizeTier(card.backText)) / CARD_W) : 24
  const last = review.i + 1 >= review.queue.length
  const graded = gradedAt === review.i

  return (
    <div className="fixed inset-0 z-30 bg-paper">
      <section className="flex h-dvh flex-col overflow-hidden">
        <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          {isHost ? (
            <ConfirmButton
              className="iconbtn"
              testId="back"
              label={<Icon name="back" size={22} />}
              armedLabel={<Icon name="close" size={20} />}
              toastMsg="Tap again to end the session for everyone"
              onConfirm={() => {
                send({ type: 'review-end' })
                onExit()
              }}
            />
          ) : (
            <button className="iconbtn" data-testid="back" title="Leave the group review (it continues without you)" onClick={onExit}>
              <Icon name="back" size={22} />
            </button>
          )}
          <h1 className="m-0 flex flex-1 items-center gap-1.5 truncate text-[17px] font-bold tracking-tight">
            <Icon name="play" size={16} /> <span className="truncate">{meta ? `${meta.name} · by ${meta.by}` : 'Group review'}</span>
          </h1>
          <span className="text-xs font-semibold text-muted" data-testid="rr-progress">
            {review.i + 1} / {review.queue.length}
          </span>
        </header>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 px-4 py-2.5">
          <div
            ref={cardWrapRef}
            className="relative w-full max-w-[640px] overflow-hidden rounded-2xl bg-white shadow-soft"
            onClick={() => isHost && !review.flipped && send({ type: 'review-flip' })}
            data-testid="rr-card"
          >
            <canvas ref={canvasRef} className="block aspect-[8/5] w-full bg-white" />
            {!card && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">⏳ fetching card…</div>
            )}
            {showDomText && (
              <div
                data-testid="rr-answer"
                className="absolute inset-0 flex justify-center overflow-hidden px-[7%] pb-[6%] pt-[7%] text-center font-semibold text-ink"
                style={{
                  fontFamily: 'var(--font-thai)',
                  fontSize: textPx,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  wordBreak: 'normal',
                  alignItems: card && card.back.length ? 'flex-start' : 'center',
                }}
              >
                {card?.backText}
              </div>
            )}
            <span className="absolute left-3 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[.08em] text-muted">
              {side}
            </span>
          </div>

          {!review.flipped ? (
            <div className="flex flex-col items-center gap-2.5">
              <div className="text-[13px] text-muted">
                {isHost ? 'Tap the card (or the button) to reveal for everyone' : `${review.hostName} will reveal the answer…`}
              </div>
              {isHost && (
                <button className="btn btn-primary" data-testid="rr-flip" onClick={() => send({ type: 'review-flip' })}>
                  <Icon name="reveal" size={16} /> Reveal
                </button>
              )}
            </div>
          ) : (
            <div className="flex w-full max-w-[640px] flex-col gap-2.5">
              <div className="flex w-full gap-2">
                {(
                  [
                    [0, 'Again', iv ? fmtIv(iv.again) : '', 'bg-again'],
                    [1, 'Hard', iv ? fmtIv(iv.hard) : '', 'bg-hard'],
                    [2, 'Good', iv ? fmtIv(iv.good) : '', 'bg-good'],
                    [3, 'Easy', '✓ done', 'bg-easy'],
                  ] as const
                ).map(([g, label, sub, bg]) => (
                  <button
                    key={g}
                    className={`flex flex-1 flex-col gap-0.5 rounded-[13px] px-1 py-3 text-sm font-bold text-white shadow-soft disabled:opacity-40 ${bg}`}
                    disabled={graded}
                    data-testid={'rr-grade-' + g}
                    onClick={() => doGrade(g)}
                  >
                    {label}
                    <small className="text-[10px] font-semibold opacity-85">{sub}</small>
                  </button>
                ))}
              </div>
              <div className="flex items-center justify-center gap-2.5">
                {graded && <span className="text-[13px] text-muted">✓ noted for you</span>}
                {isHost && (
                  <button className="btn btn-primary" data-testid="rr-next" onClick={() => send({ type: 'review-next' })}>
                    {last ? (
                      <>
                        <Icon name="finish" size={15} /> Finish
                      </>
                    ) : (
                      <>
                        Next <Icon name="next" size={15} />
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
