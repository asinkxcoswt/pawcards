import { CARD_H, CARD_W } from './constants'
import type { Card, FrontText, Stroke } from './types'

/** Stroke rendering + card painting. Strokes live in logical 800×500 space. */

export function renderStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], scale: number): void {
  ctx.save()
  for (const s of strokes) {
    const pts = s.pts
    if (!pts.length) continue
    ctx.globalAlpha = s.tool === 'hl' ? 0.4 : 1
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = s.size * scale
    if (pts.length === 1) {
      ctx.beginPath()
      ctx.arc(pts[0].x * scale, pts[0].y * scale, (s.size * scale) / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    ctx.beginPath()
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale)
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]
      const q = pts[i + 1]
      ctx.quadraticCurveTo(p.x * scale, p.y * scale, ((p.x + q.x) / 2) * scale, ((p.y + q.y) / 2) * scale)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x * scale, last.y * scale)
    ctx.stroke()
  }
  ctx.restore()
}

/** image cache for generated backgrounds */
const imgCache: Record<string, HTMLImageElement> = {}

/** draw a background image with cover fit; returns false and schedules repaint if not loaded yet */
export function drawBg(
  ctx: CanvasRenderingContext2D,
  url: string,
  w: number,
  h: number,
  repaint?: () => void,
): boolean {
  let im = imgCache[url]
  if (!im) {
    im = new Image()
    im.src = url
    imgCache[url] = im
  }
  if (im.complete && im.naturalWidth) {
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight)
    const dw = im.naturalWidth * s
    const dh = im.naturalHeight * s
    ctx.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh)
    return true
  }
  if (repaint && !im.complete) im.addEventListener('load', repaint, { once: true })
  return false
}

export interface PaintOpts {
  /** thumbnails preview the answer text faintly on text-only cards */
  thumb?: boolean
  /** review paints back-side ink only — the answer text is a DOM overlay */
  skipBackText?: boolean
  /** review/editor render the front caption as a DOM overlay instead */
  skipFrontText?: boolean
}

export function paintCard(
  cv: HTMLCanvasElement,
  c: Card,
  side: 'front' | 'back',
  cssW: number,
  opts: PaintOpts = {},
): void {
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(cssW)
  const h = Math.round((cssW * CARD_H) / CARD_W)
  cv.width = w * dpr
  cv.height = h * dpr
  cv.style.width = w + 'px'
  cv.style.height = h + 'px'
  const ctx = cv.getContext('2d')!
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  const bg = side === 'front' ? c.polished?.front : undefined
  if (bg) drawBg(ctx, bg, w, h, () => paintCard(cv, c, side, cssW, opts))
  renderStrokes(ctx, c[side] ?? [], w / CARD_W)
  if (side === 'back' && !opts.skipBackText && c.backText.trim()) {
    drawCardText(ctx, c.backText, w, h, (c.back ?? []).length > 0)
  }
  if (opts.thumb && side === 'front' && !bg && !(c.front ?? []).length && !c.frontText?.text.trim() && c.backText.trim()) {
    drawCardText(ctx, c.backText, w, h, false, 'rgba(34,33,31,.4)')
  }
  if (side === 'front' && !opts.skipFrontText && c.frontText?.text.trim()) drawFrontText(ctx, c.frontText, w, h)
}

/* ---------- Thai-aware canvas text (used for thumbnails only; review uses DOM) ---------- */

export const THAI_RE = /[฀-๿]/
const TH_MARK = /[ัิ-ฺ็-๎]/ // combining marks — never start a line

let _thSeg: Intl.Segmenter | false | null = null
function thaiSegments(str: string): string[] | null {
  if (_thSeg === null) {
    try {
      _thSeg =
        typeof Intl !== 'undefined' && 'Segmenter' in Intl
          ? new Intl.Segmenter('th', { granularity: 'word' })
          : false
    } catch {
      _thSeg = false
    }
  }
  return _thSeg ? Array.from(_thSeg.segment(str), (s) => s.segment) : null
}

export function fontSizeTier(text: string): number {
  const len = text.replace(/\s+/g, ' ').trim().length
  return len <= 40 ? 56 : len <= 90 ? 46 : len <= 180 ? 38 : 30
}

/** wrap `clean` to fit `maxW` at the ctx's current font (Thai-segment aware) */
export function wrapLines(ctx: CanvasRenderingContext2D, clean: string, maxW: number): string[] {
  const measure = (t: string) => ctx.measureText(t).width
  const tokens = (para: string): string[] => {
    const out: string[] = []
    for (const part of para.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) {
        out.push(' ')
        continue
      }
      const seg = THAI_RE.test(part) ? thaiSegments(part) : null
      if (seg) out.push(...seg)
      else out.push(part)
    }
    return out
  }
  const lines: string[] = []
  for (const para of clean.split('\n')) {
    let line = ''
    for (const tok of tokens(para)) {
      if (tok === ' ') {
        if (line) line += ' '
        continue
      }
      if (measure(tok) > maxW) {
        if (line.trim()) lines.push(line.trimEnd())
        let rest = tok
        while (measure(rest) > maxW && rest.length > 1) {
          let cut = Math.max(1, Math.floor((rest.length * maxW) / measure(rest)))
          while (cut > 1 && measure(rest.slice(0, cut)) > maxW) cut--
          while (cut < rest.length && TH_MARK.test(rest[cut])) cut++
          lines.push(rest.slice(0, cut))
          rest = rest.slice(cut)
        }
        line = rest
        continue
      }
      const test = line + tok
      if (measure(test) > maxW && line.trim()) {
        lines.push(line.trimEnd())
        line = tok
      } else line = test
    }
    lines.push(line.trimEnd())
  }
  return lines
}

/** draw the front caption (bg box + text) onto a canvas — thumbnails & export */
export function drawFrontText(ctx: CanvasRenderingContext2D, ft: FrontText, w: number, h: number): void {
  const clean = ft.text.replace(/\s+$/, '')
  if (!clean) return
  const scale = w / CARD_W
  const size = ft.size * scale
  const isThai = THAI_RE.test(clean)
  const lh = size * (isThai ? 1.5 : 1.28)
  ctx.save()
  ctx.font = '600 ' + size + 'px "Sukhumvit Set", Thonburi, system-ui, "Segoe UI", Roboto, sans-serif'
  ctx.textBaseline = 'top'
  const padX = 14 * scale
  const padY = 10 * scale
  const lines = wrapLines(ctx, clean, w - padX * 2)
  const boxTop = Math.max(0, Math.min(h, ft.y * h))
  const boxH = lines.length * lh + padY * 2
  if (ft.bg !== 'none' && ft.bgAlpha > 0) {
    ctx.globalAlpha = ft.bgAlpha
    ctx.fillStyle = ft.bg
    ctx.fillRect(0, boxTop, w, boxH)
    ctx.globalAlpha = 1
  }
  ctx.fillStyle = ft.color
  ctx.textAlign = ft.align
  const tx = ft.align === 'left' ? padX : ft.align === 'right' ? w - padX : w / 2
  let y = boxTop + padY
  for (const l of lines) {
    ctx.fillText(l, tx, y)
    y += lh
  }
  ctx.restore()
}

export function drawCardText(
  ctx: CanvasRenderingContext2D,
  text: string,
  w: number,
  h: number,
  hasInk: boolean,
  color?: string,
): void {
  const scale = w / CARD_W
  const clean = text.replace(/\s+$/, '')
  const isThai = THAI_RE.test(clean)
  const size = fontSizeTier(clean) * scale
  const lh = size * (isThai ? 1.55 : 1.3) // Thai stacks vowels/tones — needs air
  ctx.save()
  // NOTE: iOS canvas measureText is unreliable for Thai — that's why review
  // renders the answer as DOM. This canvas path only serves small thumbnails.
  ctx.font = '600 ' + size + 'px "Sukhumvit Set", Thonburi, system-ui, "Segoe UI", Roboto, sans-serif'
  ctx.fillStyle = color ?? '#22211f'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const maxW = w * 0.86
  const lines = wrapLines(ctx, clean, maxW)

  const maxLines = Math.max(1, Math.floor((h - 30 * scale) / lh))
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[lines.length - 1] += '…'
  }
  const totalH = lines.length * lh
  let y = hasInk ? 16 * scale : Math.max(16 * scale, (h - totalH) / 2)
  const pad = (lh - size) / 2
  for (const l of lines) {
    ctx.fillText(l, w / 2, y + pad)
    y += lh
  }
  ctx.restore()
}

/** render the composite front (bg + ink) to a PNG blob, for export */
export async function frontToBlob(c: Card): Promise<Blob> {
  const cv = document.createElement('canvas')
  cv.width = 1024
  cv.height = 640
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, 1024, 640)
  const bg = c.polished?.front
  if (bg) {
    try {
      const im = new Image()
      im.src = bg
      await new Promise((res, rej) => {
        im.onload = res
        im.onerror = rej
      })
      const s = Math.max(1024 / im.naturalWidth, 640 / im.naturalHeight)
      ctx.drawImage(
        im,
        (1024 - im.naturalWidth * s) / 2,
        (640 - im.naturalHeight * s) / 2,
        im.naturalWidth * s,
        im.naturalHeight * s,
      )
    } catch {
      /* bg failed to load — export ink only */
    }
  }
  renderStrokes(ctx, c.front, 1024 / CARD_W)
  if (c.frontText?.text.trim()) drawFrontText(ctx, c.frontText, 1024, 640)
  return new Promise((res) => cv.toBlob((b) => res(b!), 'image/png'))
}
