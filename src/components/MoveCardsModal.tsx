import { useStore } from '../store'
import Icon from './Icon'

/** Pick the deck to move the selected cards into. Lists every other deck with
 *  its colour and size so the destination is easy to recognise. */
export default function MoveCardsModal({
  count,
  fromDeckId,
  onMove,
  onClose,
}: {
  count: number
  fromDeckId: string
  onMove: (toDeckId: string) => void
  onClose: () => void
}) {
  const decks = useStore((s) => s.decks)
  const cards = useStore((s) => s.cards)
  const targets = decks.filter((d) => d.id !== fromDeckId)

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="max-h-[70dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        data-testid="move-cards-modal"
      >
        <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
          <Icon name="move" size={17} /> Move {count} card{count === 1 ? '' : 's'} to…
        </h2>
        <p className="hint mb-3.5">
          The cards keep their drawings and review schedule — only their deck changes.
        </p>

        {targets.length === 0 ? (
          <p className="hint">This is your only deck — create another one first, then move cards into it.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {targets.map((d) => (
              <button
                key={d.id}
                className="btn justify-start gap-2.5"
                data-testid={'move-to-' + d.id}
                onClick={() => onMove(d.id)}
              >
                <span className="h-3 w-3 shrink-0 rounded" style={{ background: d.color }} />
                <span className="truncate">{d.name}</span>
                <span className="ml-auto shrink-0 text-xs font-normal text-muted">
                  {cards.filter((c) => c.deckId === d.id).length} cards
                </span>
              </button>
            ))}
          </div>
        )}

        <button className="btn btn-ghost mt-4" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
