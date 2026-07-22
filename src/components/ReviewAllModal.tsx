import { useState } from 'react'
import Icon from './Icon'

/**
 * "Review all" — a cram session over the whole deck: pick how many cards and
 * whether to shuffle or follow the deck's own order. Same count picker as the
 * room's group-review start dialog.
 */
export default function ReviewAllModal({
  total,
  onStart,
  onClose,
}: {
  total: number
  onStart: (opts: { count: number; shuffle: boolean }) => void
  onClose: () => void
}) {
  const [count, setCount] = useState(total)
  const [shuffle, setShuffle] = useState(true)

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
        data-testid="review-all-modal"
      >
        <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
          <Icon name="play" size={17} /> Review all
        </h2>
        <p className="hint mb-3.5">
          Practice any card, due or not. Grades here don't change your schedule — except “Again” on a finished card,
          which brings it back.
        </p>

        <label className="field-label">How many cards?</label>
        <div className="mb-4 rounded-xl border border-line bg-paper p-4">
          <div className="mb-3 text-center">
            <span className="text-[32px] font-extrabold leading-none text-ink" data-testid="ra-count-value">
              {count}
            </span>
            <span className="ml-1.5 text-sm text-muted">of {total} cards</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              className="iconbtn shrink-0 text-lg"
              data-testid="ra-count-dec"
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
              max={total}
              step={1}
              value={count}
              data-testid="ra-count-input"
              onChange={(e) => setCount(parseInt(e.target.value, 10) || 1)}
            />
            <button
              className="iconbtn shrink-0 text-lg"
              data-testid="ra-count-inc"
              aria-label="One more"
              onClick={() => setCount((c) => Math.min(total, c + 1))}
            >
              <Icon name="plus" size={18} strokeWidth={2.4} />
            </button>
          </div>
          <button
            className={'btn mt-3 w-full justify-center ' + (count >= total ? 'btn-primary' : '')}
            data-testid="ra-count-all"
            onClick={() => setCount(total)}
          >
            All {total} cards
          </button>
        </div>

        <label className="field-label">Order</label>
        <div className="mb-4 flex gap-2">
          <button
            className={'btn flex-1 justify-center ' + (shuffle ? 'btn-primary' : '')}
            data-testid="ra-shuffle"
            aria-pressed={shuffle}
            onClick={() => setShuffle(true)}
          >
            <Icon name="dice" size={15} /> Shuffle
          </button>
          <button
            className={'btn flex-1 justify-center ' + (!shuffle ? 'btn-primary' : '')}
            data-testid="ra-inorder"
            aria-pressed={!shuffle}
            onClick={() => setShuffle(false)}
          >
            <Icon name="list" size={15} /> In order
          </button>
        </div>

        <div className="flex gap-2.5">
          <button className="btn btn-accent" data-testid="ra-start" onClick={() => onStart({ count, shuffle })}>
            <Icon name="play" size={16} /> Start
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
