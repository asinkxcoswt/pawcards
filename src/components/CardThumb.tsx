import { useEffect, useRef } from 'react'
import { paintCard } from '../lib/canvas'
import type { Card } from '../lib/types'

export default function CardThumb({ card }: { card: Card }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const w = cv.parentElement?.clientWidth || 150
    paintCard(cv, card, 'front', w, { thumb: true })
  }, [card])
  return <canvas ref={ref} className="block w-full aspect-[8/5] bg-white" />
}
