import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { fmtIv, previewIntervals } from '../lib/srs'
import { fontSizeTier, paintCard } from '../lib/canvas'
import { CARD_W } from '../lib/constants'
import Icon from './Icon'
import { FrontCaptionView } from './FrontTextLayer'

export default function Review() {
  const session = useStore((s) => s.session)
  const cards = useStore((s) => s.cards)
  const decks = useStore((s) => s.decks)
  const { flip, grade, endReview } = useStore.getState()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardWrapRef = useRef<HTMLDivElement>(null)
  const [wrapW, setWrapW] = useState(0)

  useEffect(() => {
    const el = cardWrapRef.current
    if (!el) return
    const set = () => setWrapW(el.clientWidth)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const card = session ? cards.find((c) => c.id === session.queue[session.i]) : undefined
  const side: 'front' | 'back' = session?.flipped ? 'back' : 'front'
  const showDomText = side === 'back' && !!card?.backText.trim()

  useEffect(() => {
    const cv = canvasRef.current
    const wrap = cardWrapRef.current
    if (!cv || !wrap || !card) return
    // review back: canvas paints legacy ink only — the answer text is real DOM
    // so Thai (and every other script) wraps with the browser's native engine
    paintCard(cv, card, side, wrap.clientWidth, { skipBackText: true, skipFrontText: true })
  }, [card, side])

  if (!session || !card) return null

  const deckName = session.deckId ? (decks.find((d) => d.id === session.deckId)?.name ?? '') : 'All decks'
  const iv = previewIntervals(card)
  const textPx = cardWrapRef.current
    ? Math.round((cardWrapRef.current.clientWidth * fontSizeTier(card.backText)) / CARD_W)
    : 24

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button className="iconbtn" data-testid="back" title="Back" onClick={endReview}>
          <Icon name="back" size={22} />
        </button>
        <h1 className="m-0 flex-1 truncate text-[19px] font-bold tracking-tight">
          {(session.cram ? 'Shuffle — ' : '') + deckName}
        </h1>
        <span className="text-xs font-semibold text-muted">
          {session.done + 1} / {session.total}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 px-4 py-2.5">
        <div
          ref={cardWrapRef}
          className="relative w-full max-w-[640px] overflow-hidden rounded-2xl bg-white shadow-soft"
          onClick={() => !session.flipped && flip()}
          data-testid="review-card"
        >
          <canvas ref={canvasRef} className="block aspect-[8/5] w-full bg-white" />
          {side === 'front' && card.frontText?.text.trim() && wrapW > 0 && (
            <FrontCaptionView ft={card.frontText} cardW={wrapW} />
          )}
          {showDomText && (
            <div
              data-testid="review-answer"
              className="absolute inset-0 flex justify-center overflow-hidden px-[7%] pb-[6%] pt-[7%] text-center font-semibold text-ink"
              style={{
                fontFamily: 'var(--font-thai)',
                fontSize: textPx,
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                wordBreak: 'normal',
                alignItems: card.back.length ? 'flex-start' : 'center',
              }}
            >
              {card.backText}
            </div>
          )}
          <span className="absolute left-3 top-2.5 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-[.08em] text-muted">
            {side}
          </span>
        </div>

        {!session.flipped ? (
          <div className="text-[13px] text-muted">Tap the card to reveal the answer</div>
        ) : (
          <div className="flex w-full max-w-[640px] gap-2">
            {(
              [
                [0, 'Again', fmtIv(iv.again), 'bg-again'],
                [1, 'Hard', fmtIv(iv.hard), 'bg-hard'],
                [2, 'Good', fmtIv(iv.good), 'bg-good'],
                [3, 'Easy', '✓ done', 'bg-easy'],
              ] as const
            ).map(([g, label, sub, bg]) => (
              <button
                key={g}
                className={`flex flex-1 flex-col gap-0.5 rounded-[13px] px-1 py-3 text-sm font-bold text-white shadow-soft ${bg}`}
                onClick={() => grade(g)}
              >
                {label}
                <small className="text-[10px] font-semibold opacity-85">{sub}</small>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
