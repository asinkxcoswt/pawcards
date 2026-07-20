import { useEffect, useRef, type RefObject } from 'react'
import { useStore } from '../store'
import { CARD_H, CARD_W, PEN_COLORS } from '../lib/constants'
import type { FrontText } from '../lib/types'
import Icon from './Icon'

const TEXT_SIZES = [
  { n: 'S', v: 30 },
  { n: 'M', v: 44 },
  { n: 'L', v: 62 },
]
const TEXT_COLORS = ['#ffffff', '#1a1a1a', ...PEN_COLORS.slice(2)]
const BG_COLORS = ['none', '#000000', '#ffffff', ...PEN_COLORS.slice(2, 6)]

function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** read-only caption, positioned/styled from `ft` — used in the editor (idle),
 *  Review, and anywhere the front is shown as DOM. */
export function FrontCaptionView({
  ft,
  cardW,
  onClick,
  testId,
}: {
  ft: FrontText
  cardW: number
  onClick?: () => void
  testId?: string
}) {
  const cardH = (cardW * CARD_H) / CARD_W
  const fontPx = (ft.size * cardW) / CARD_W
  return (
    <div
      className="absolute inset-x-0 z-[6]"
      style={{ top: ft.y * cardH, background: ft.bg === 'none' ? 'transparent' : rgba(ft.bg, ft.bgAlpha) }}
      onClick={onClick}
      data-testid={testId}
    >
      <div
        className="w-full whitespace-pre-wrap px-[3.5%] py-[2.5%]"
        style={{ color: ft.color, fontSize: fontPx, lineHeight: 1.35, textAlign: ft.align, fontFamily: 'var(--font-thai)', overflowWrap: 'anywhere' }}
      >
        {ft.text || ' '}
      </div>
    </div>
  )
}

export const defaultFrontText = (): FrontText => ({
  text: '',
  y: 0.72,
  size: 44,
  color: '#ffffff',
  align: 'center',
  bg: '#000000',
  bgAlpha: 0.45,
})

/**
 * The front caption — a full-width, vertically-movable text box drawn as a DOM
 * overlay (native wrapping, correct Thai). Editing here; Review/thumbnails/export
 * re-render it on canvas via lib/canvas. `selected` shows the editor chrome.
 */
export default function FrontTextLayer({
  cardId,
  ft,
  cardW,
  cardElRef,
  selected,
  onSelect,
  onDone,
}: {
  cardId: string
  ft: FrontText
  cardW: number
  cardElRef: RefObject<HTMLDivElement | null>
  selected: boolean
  onSelect: () => void
  onDone: () => void
}) {
  const { setFrontText } = useStore.getState()
  const taRef = useRef<HTMLTextAreaElement>(null)
  const patch = (p: Partial<FrontText>) => setFrontText(cardId, { ...ft, ...p })

  const cardH = (cardW * CARD_H) / CARD_W
  const fontPx = (ft.size * cardW) / CARD_W

  useEffect(() => {
    if (selected) taRef.current?.focus()
  }, [selected])
  // grow the textarea to its content
  const grow = () => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }
  useEffect(grow, [ft.text, fontPx, selected])

  const drag = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => {
      const box = cardElRef.current?.getBoundingClientRect()
      if (!box) return
      patch({ y: Math.max(0, Math.min(0.95, (ev.clientY - box.top) / box.height)) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {selected ? (
        <div className="absolute inset-x-0 z-[6]" style={{ top: ft.y * cardH, background: ft.bg === 'none' ? 'transparent' : rgba(ft.bg, ft.bgAlpha) }}>
          <button
            className="absolute -top-3.5 right-1 z-[7] flex h-7 w-7 items-center justify-center rounded-full bg-ink text-white shadow-soft"
            aria-label="Move caption"
            data-testid="front-text-move"
            onPointerDown={drag}
            style={{ touchAction: 'none' }}
          >
            <Icon name="move" size={15} />
          </button>
          <textarea
            ref={taRef}
            className="block w-full resize-none overflow-hidden border-0 bg-transparent px-[3.5%] py-[2.5%] outline-none"
            style={{ color: ft.color, fontSize: fontPx, lineHeight: 1.35, textAlign: ft.align, fontFamily: 'var(--font-thai)' }}
            placeholder="Caption…"
            value={ft.text}
            data-testid="front-text-input"
            onInput={grow}
            onChange={(e) => patch({ text: e.target.value })}
          />
        </div>
      ) : (
        <FrontCaptionView ft={ft} cardW={cardW} onClick={onSelect} testId="front-text-display" />
      )}

      {selected && (
        <div className="absolute inset-x-2 top-2 z-[8] rounded-xl bg-panel/95 p-2 shadow-soft" data-testid="front-text-format">
          <div className="flex flex-wrap items-center gap-2">
            {TEXT_SIZES.map((s) => (
              <button key={s.n} className={'tool text-[13px] font-bold ' + (ft.size === s.v ? 'tool-on' : '')} onClick={() => patch({ size: s.v })}>
                {s.n}
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-line" />
            {(['left', 'center', 'right'] as const).map((a) => (
              <button key={a} className={'tool ' + (ft.align === a ? 'tool-on' : '')} onClick={() => patch({ align: a })} aria-label={a}>
                <AlignGlyph a={a} />
              </button>
            ))}
            <span className="mx-0.5 h-5 w-px bg-line" />
            <button className="tool text-again" data-testid="front-text-delete" aria-label="Remove caption" onClick={() => { setFrontText(cardId, undefined); onDone() }}>
              <Icon name="delete" size={16} />
            </button>
            <button className="btn btn-primary ml-auto px-3 py-1 text-[13px]" data-testid="front-text-done" onClick={onDone}>
              Done
            </button>
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="w-9 text-[11px] font-bold text-muted">Text</span>
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                className={'h-6 w-6 rounded-full border border-black/10 ' + (ft.color === c ? 'outline-2 outline-offset-1 outline-accent' : '')}
                style={{ background: c }}
                onClick={() => patch({ color: c })}
                aria-label={'text ' + c}
              />
            ))}
          </div>
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="w-9 text-[11px] font-bold text-muted">Box</span>
            {BG_COLORS.map((c) => (
              <button
                key={c}
                className={'flex h-6 w-6 items-center justify-center rounded-full border border-black/10 ' + (ft.bg === c ? 'outline-2 outline-offset-1 outline-accent' : '')}
                style={{ background: c === 'none' ? 'transparent' : c }}
                onClick={() => patch({ bg: c })}
                aria-label={'box ' + c}
              >
                {c === 'none' && <Icon name="close" size={13} />}
              </button>
            ))}
            {ft.bg !== 'none' && (
              <input
                className="ml-1 flex-1"
                style={{ accentColor: 'var(--color-accent)' }}
                type="range"
                min={0}
                max={100}
                value={Math.round(ft.bgAlpha * 100)}
                aria-label="Box opacity"
                onChange={(e) => patch({ bgAlpha: (parseInt(e.target.value, 10) || 0) / 100 })}
              />
            )}
          </div>
        </div>
      )}
    </>
  )
}

function AlignGlyph({ a }: { a: 'left' | 'center' | 'right' }) {
  const justify = a === 'left' ? 'items-start' : a === 'right' ? 'items-end' : 'items-center'
  return (
    <span className={'flex flex-col gap-0.5 ' + justify}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={'h-0.5 rounded-full bg-current ' + (i === 1 ? 'w-2.5' : 'w-4')} />
      ))}
    </span>
  )
}
