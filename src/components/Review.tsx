import { useStore } from '../store'
import { fmtIv, previewIntervals } from '../lib/srs'
import CardFace from './CardFace'
import Icon from './Icon'

export default function Review() {
  const session = useStore((s) => s.session)
  const cards = useStore((s) => s.cards)
  const decks = useStore((s) => s.decks)
  const { flip, grade, endReview } = useStore.getState()

  const card = session ? cards.find((c) => c.id === session.queue[session.i]) : undefined
  const side: 'front' | 'back' = session?.flipped ? 'back' : 'front'

  if (!session || !card) return null

  const deckName = session.deckId ? (decks.find((d) => d.id === session.deckId)?.name ?? '') : 'All decks'
  const iv = previewIntervals(card)

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
        <CardFace
          card={card}
          side={side}
          className="max-w-[640px]"
          onClick={() => !session.flipped && flip()}
          testId="review-card"
          answerTestId="review-answer"
        />

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
