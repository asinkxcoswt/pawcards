import { useEffect, useRef, useState } from 'react'
import { paintCard } from '../lib/canvas'
import { FrontCaptionView } from './FrontTextLayer'
import type { Card } from '../lib/types'

export default function CardThumb({ card }: { card: Card }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const cv = ref.current
    const parent = cv?.parentElement
    if (!cv || !parent) return
    let painted = 0
    const paint = () => {
      const w = parent.clientWidth || 150
      if (w === painted) return // repaint only on real width changes
      painted = w
      setWidth(w)
      paintCard(cv, card, 'front', w, { thumb: true })
    }
    paint()
    // the grid can settle after first paint (scrollbar, font load) — track it
    const ro = new ResizeObserver(paint)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [card])
  // the caption rides as a DOM overlay (native Thai wrapping + correct
  // position) instead of canvas text, which mis-measures Thai on iOS
  const ft = card.frontText
  return (
    <div className="relative block w-full aspect-[8/5]">
      <canvas ref={ref} className="block h-full w-full bg-white" />
      {ft?.text.trim() && width > 0 && <FrontCaptionView ft={ft} cardW={width} interactive={false} />}
    </div>
  )
}
