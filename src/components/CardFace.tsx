import { useEffect, useRef, useState } from 'react'
import { fontSizeTier, paintCard } from '../lib/canvas'
import { CARD_W } from '../lib/constants'
import { FrontCaptionView } from './FrontTextLayer'
import type { Card } from '../lib/types'

/**
 * One face of a card, rendered the way Review shows it: canvas for the image
 * + ink, DOM overlays for the front caption and the back answer text (so Thai
 * and every other script wrap with the browser's native engine, not canvas).
 * Reused by Review and the editor preview.
 */
export default function CardFace({
  card,
  side,
  onClick,
  className,
  testId,
  answerTestId,
}: {
  card: Card
  side: 'front' | 'back'
  onClick?: () => void
  className?: string
  testId?: string
  answerTestId?: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [wrapW, setWrapW] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const set = () => setWrapW(el.clientWidth)
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    paintCard(cv, card, side, wrap.clientWidth, { skipBackText: true, skipFrontText: true })
  }, [card, side, wrapW])

  const showAnswer = side === 'back' && !!card.backText.trim()
  const textPx = wrapW ? Math.round((wrapW * fontSizeTier(card.backText)) / CARD_W) : 24

  return (
    <div
      ref={wrapRef}
      className={'relative w-full overflow-hidden rounded-2xl bg-white shadow-soft ' + (className ?? '')}
      onClick={onClick}
      data-testid={testId}
    >
      <canvas ref={canvasRef} className="block aspect-[8/5] w-full bg-white" />
      {side === 'front' && card.frontText?.text.trim() && wrapW > 0 && (
        <FrontCaptionView ft={card.frontText} cardW={wrapW} />
      )}
      {showAnswer && (
        <div
          data-testid={answerTestId}
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
  )
}
