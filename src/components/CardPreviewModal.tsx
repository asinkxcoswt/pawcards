import { useState } from 'react'
import CardFace from './CardFace'
import Icon from './Icon'
import type { Card } from '../lib/types'

/**
 * Full-screen preview of the card as it appears in review — front image + ink
 * + caption, tap to flip to the answer. Opened from the editor so you can
 * check a card without leaving editing.
 */
export default function CardPreviewModal({
  card,
  onClose,
  title = 'Preview',
}: {
  card: Card
  onClose: () => void
  /** heading — "Preview" from the editor, "Review" when picking cards to study */
  title?: string
}) {
  const [flipped, setFlipped] = useState(false)
  const side: 'front' | 'back' = flipped ? 'back' : 'front'

  return (
    // near-opaque + blurred: at 78% the page header behind showed through and
    // collided with this one's title
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(20,18,15,.94)] backdrop-blur-sm" data-testid="card-preview">
      <div className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <h1 className="m-0 flex-1 text-[17px] font-bold text-white">{title}</h1>
        <button
          className="iconbtn bg-white/15 text-white"
          data-testid="preview-close"
          title="Close preview"
          onClick={onClose}
        >
          <Icon name="close" size={20} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5 px-4 pb-6">
        <CardFace
          card={card}
          side={side}
          className="max-w-[640px] cursor-pointer"
          onClick={() => setFlipped((f) => !f)}
          testId="preview-card"
          answerTestId="preview-answer"
        />
        <div className="text-[13px] text-white/70">Tap the card to flip — this is how it looks in review</div>
      </div>
    </div>
  )
}
