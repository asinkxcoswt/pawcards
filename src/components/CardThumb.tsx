import { useEffect, useRef } from 'react'
import { paintCard } from '../lib/canvas'
import type { Card } from '../lib/types'

export default function CardThumb({ card }: { card: Card }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    const parent = cv?.parentElement
    if (!cv || !parent) return
    let painted = 0
    const paint = () => {
      const w = parent.clientWidth || 150
      if (w === painted) return // repaint only on real width changes
      painted = w
      paintCard(cv, card, 'front', w, { thumb: true })
    }
    paint()
    // the grid can settle after first paint (scrollbar, font load) — track it
    const ro = new ResizeObserver(paint)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [card])
  return <canvas ref={ref} className="block w-full aspect-[8/5] bg-white" />
}
