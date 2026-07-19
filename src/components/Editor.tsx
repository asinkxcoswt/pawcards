import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { CARD_H, CARD_W } from '../lib/constants'
import { HL_COLORS, PEN_COLORS, SIZES } from '../lib/constants'
import { drawBg, frontToBlob, renderStrokes } from '../lib/canvas'
import type { Stroke } from '../lib/types'
import ConfirmButton from './ConfirmButton'

type ToolType = 'pen' | 'hl' | 'eraser'

/** module-level so palm rejection persists across editor opens */
let penSeen = false

export default function Editor() {
  const cardId = useStore((s) => s.curCardId)!
  const card = useStore((s) => s.cards.find((c) => c.id === cardId))
  const polishing = useStore((s) => s.polishJobs.some((j) => j.cardId === cardId))
  const { closeEditor, deleteCard, setBackText, setFront, setBackground, clearBackground, requestPolish, showToast } =
    useStore.getState()

  const [tool, setTool] = useState<ToolType>('pen')
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [hlColor, setHlColor] = useState(HL_COLORS[0])
  const [sizeIdx, setSizeIdx] = useState(1)
  const [attn, setAttn] = useState(false)
  const [genMenu, setGenMenu] = useState(false)
  const [customOpen, setCustomOpen] = useState(false)
  const [customPrompt, setCustomPrompt] = useState('')

  const wrapRef = useRef<HTMLDivElement>(null)
  const groupRef = useRef<HTMLDivElement>(null)
  const cardElRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const backTextRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // drawing session state lives in refs — no re-render per pointermove
  const strokesRef = useRef<Stroke[]>(card?.front ?? [])
  const drawingRef = useRef<Stroke | null>(null)
  const scaleRef = useRef(1)
  const undoRef = useRef<string[]>([])
  const redoRef = useRef<string[]>([])
  const bgRef = useRef<string | undefined>(card?.polished.front)
  bgRef.current = card?.polished.front

  const redraw = useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const ctx = cv.getContext('2d')!
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const w = cv.width / dpr
    const h = cv.height / dpr
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, w, h)
    if (bgRef.current) drawBg(ctx, bgRef.current, w, h, redraw)
    renderStrokes(ctx, strokesRef.current, scaleRef.current)
    if (drawingRef.current) renderStrokes(ctx, [drawingRef.current], scaleRef.current)
  }, [])

  const fit = useCallback(() => {
    const wrap = wrapRef.current
    const cardEl = cardElRef.current
    const cv = canvasRef.current
    if (!wrap || !cardEl || !cv) return
    const labelH = 26
    const availW = wrap.clientWidth - 28
    const availH = wrap.clientHeight - 16 - labelH
    let w = availW
    let h = (w * CARD_H) / CARD_W
    if (h > availH) {
      h = availH
      w = (h * CARD_W) / CARD_H
    }
    if (groupRef.current) groupRef.current.style.width = w + 'px'
    cardEl.style.width = w + 'px'
    cardEl.style.height = h + 'px'
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(w * dpr)
    cv.height = Math.round(h * dpr)
    scaleRef.current = w / CARD_W
    redraw()
  }, [redraw])

  useEffect(() => {
    strokesRef.current = card?.front ?? []
    undoRef.current = []
    redoRef.current = []
    fit()
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    const h = setTimeout(() => backTextRef.current?.focus(), 60)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(h)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId])

  // repaint when the background changes (generation finished / import / clear)
  useEffect(() => {
    redraw()
  }, [card?.polished.front, redraw])

  if (!card) return null

  /* ---------- history ---------- */
  const pushHistory = () => {
    undoRef.current.push(JSON.stringify(strokesRef.current))
    if (undoRef.current.length > 40) undoRef.current.shift()
    redoRef.current = []
  }
  const commit = () => {
    setFront(cardId, strokesRef.current)
    redraw()
  }
  const undo = () => {
    if (!undoRef.current.length) return
    redoRef.current.push(JSON.stringify(strokesRef.current))
    strokesRef.current = JSON.parse(undoRef.current.pop()!)
    commit()
  }
  const redo = () => {
    if (!redoRef.current.length) return
    undoRef.current.push(JSON.stringify(strokesRef.current))
    strokesRef.current = JSON.parse(redoRef.current.pop()!)
    commit()
  }
  const clearInk = () => {
    if (!strokesRef.current.length) return
    pushHistory()
    strokesRef.current = []
    commit()
  }

  /* ---------- pointer drawing ---------- */
  const canvasPoint = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scaleRef.current, y: (e.clientY - r.top) / scaleRef.current }
  }
  const eraseAt = (p: { x: number; y: number }) => {
    const r = 18
    strokesRef.current = strokesRef.current.filter(
      (s) => !s.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < r + s.size / 2),
    )
  }
  const erasingRef = useRef(false)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'pen') penSeen = true
    if (penSeen && e.pointerType === 'touch') return // palm rejection
    e.preventDefault()
    canvasRef.current!.setPointerCapture(e.pointerId)
    const p = canvasPoint(e)
    if (tool === 'eraser') {
      pushHistory()
      erasingRef.current = true
      eraseAt(p)
      redraw()
      return
    }
    const isHl = tool === 'hl'
    drawingRef.current = {
      tool: tool as 'pen' | 'hl',
      color: isHl ? hlColor : penColor,
      size: isHl ? SIZES[sizeIdx].v * 3.2 : SIZES[sizeIdx].v,
      pts: [p],
    }
    redraw()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (penSeen && e.pointerType === 'touch') return
    if (tool === 'eraser') {
      if (erasingRef.current) {
        e.preventDefault()
        eraseAt(canvasPoint(e))
        redraw()
      }
      return
    }
    const d = drawingRef.current
    if (!d) return
    e.preventDefault()
    const native = e.nativeEvent as PointerEvent
    const events = native.getCoalescedEvents ? native.getCoalescedEvents() : [native]
    for (const ev of events) {
      const r = canvasRef.current!.getBoundingClientRect()
      const p = { x: (ev.clientX - r.left) / scaleRef.current, y: (ev.clientY - r.top) / scaleRef.current }
      const last = d.pts[d.pts.length - 1]
      if (Math.hypot(p.x - last.x, p.y - last.y) > 1.2) d.pts.push(p)
    }
    redraw()
  }
  const onPointerUp = () => {
    if (erasingRef.current) {
      erasingRef.current = false
      commit()
      return
    }
    const d = drawingRef.current
    if (!d) return
    pushHistory()
    strokesRef.current = [...strokesRef.current, d]
    drawingRef.current = null
    commit()
  }

  /* ---------- generation / import / export ---------- */
  const generate = (customSubject?: string) => {
    const res = requestPolish(cardId, customSubject)
    if (res === 'no-key') {
      showToast('Add an API key first')
    } else if (res === 'no-answer') {
      backTextRef.current?.focus()
      setAttn(true)
      setTimeout(() => setAttn(false), 1700)
      showToast('Tell me the answer first 🐾 — I use it to create the front')
    } else if (res === 'busy') {
      showToast('Already creating for this card…')
    } else {
      showToast(`✨ Creating an image from your ${customSubject ? 'prompt' : 'answer'} — you can keep working`)
    }
  }
  const openCustomPrompt = () => {
    setCustomPrompt('')
    setCustomOpen(true)
  }
  const generateCustom = () => {
    const p = customPrompt.trim()
    if (!p) {
      showToast('Describe the image first 🐾')
      return
    }
    setCustomOpen(false)
    generate(p)
  }
  const importImage = (input: HTMLInputElement) => {
    const f = input.files?.[0]
    input.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      const img = new Image()
      img.onload = () => {
        const cv = document.createElement('canvas')
        const scale = Math.min(1, 1280 / img.width)
        cv.width = Math.round(img.width * scale)
        cv.height = Math.round(img.height * scale)
        cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height)
        setBackground(cardId, cv.toDataURL('image/jpeg', 0.85))
        showToast('📷 Imported as the card background — draw away!')
      }
      img.src = r.result as string
    }
    r.readAsDataURL(f)
  }
  const exportFront = async () => {
    if (!card.front.length && !card.polished.front) {
      showToast('Nothing on the front yet ✏️')
      return
    }
    const blob = await frontToBlob(card)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'pawcard-front.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    showToast('Front exported as an image')
  }

  const colors = tool === 'hl' ? HL_COLORS : PEN_COLORS
  const curColor = tool === 'hl' ? hlColor : penColor

  return (
    <section className="flex h-dvh flex-col overflow-hidden bg-edbg">
      <div className="flex items-center gap-2 px-3 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
        <button className="iconbtn" onClick={closeEditor}>
          ‹
        </button>
        <div className="flex-1" />
        <div className="relative inline-flex">
          <button className="btn rounded-r-none" onClick={() => generate()}>
            ✨ Generate
          </button>
          <button
            className="btn -ml-px rounded-l-none px-2"
            data-testid="gen-menu"
            aria-label="Generate options"
            onClick={() => setGenMenu((v) => !v)}
          >
            ▾
          </button>
          {genMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setGenMenu(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-max rounded-xl border border-line bg-panel p-1 shadow-soft">
                <button
                  className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper"
                  onClick={() => {
                    setGenMenu(false)
                    generate()
                  }}
                >
                  ✨ From the answer
                </button>
                <button
                  className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper"
                  data-testid="gen-custom"
                  onClick={() => {
                    setGenMenu(false)
                    openCustomPrompt()
                  }}
                >
                  ✍️ With a custom prompt…
                </button>
              </div>
            </>
          )}
        </div>
        <ConfirmButton className="iconbtn text-again" label="🗑" title="Delete card" onConfirm={() => deleteCard(cardId)} toastMsg="Tap again to confirm delete" />
      </div>

      <div className="ed-label mx-5 mb-1 mt-1.5">Back · the answer</div>
      <textarea
        ref={backTextRef}
        className={'mx-3.5 h-[118px] max-h-[40dvh] min-h-[72px] resize-y rounded-xl border border-line bg-panel px-3 py-2.5 text-[15px] leading-[1.45] text-ink ' + (attn ? 'attn' : '')}
        placeholder="Type the key takeaway — I'll use it when creating the front image ✨"
        value={card.backText}
        onChange={(e) => setBackText(cardId, e.target.value)}
      />

      <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center px-3.5 py-2">
        <div ref={groupRef} className="flex max-h-full max-w-full flex-col">
          <div className="ed-label mx-1.5 mb-1.5 flex items-center">Front · draw or ✨ from the answer</div>
          <div ref={cardElRef} className="relative touch-none overflow-hidden rounded-2xl bg-white shadow-soft">
            <canvas
              ref={canvasRef}
              className="block h-full w-full touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                drawingRef.current = null
                erasingRef.current = false
                redraw()
              }}
            />
            {polishing && (
              <div className="absolute left-2.5 top-2.5 z-[5] rounded-full bg-[rgba(25,25,25,.8)] px-3 py-1.5 text-xs font-semibold text-white">
                ✨ creating…
              </div>
            )}
            {card.polished.front && (
              <ConfirmButton
                className="absolute right-2.5 top-2.5 z-[5] rounded-full bg-[rgba(25,25,25,.8)] px-3 py-1.5 text-xs font-bold text-white"
                label="✕ image"
                armedLabel="Remove?"
                title="Remove the generated image (keeps your ink)"
                toastMsg="Tap again to remove the image"
                onConfirm={() => {
                  clearBackground(cardId)
                  showToast('Image removed — your ink is untouched ✏️')
                }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 px-3 pt-2.5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}>
        <div className="tool-group">
          {(
            [
              ['pen', '✏️', 'Pen'],
              ['hl', '🖍️', 'Highlighter'],
              ['eraser', '⬜', 'Eraser'],
            ] as const
          ).map(([t, icon, title]) => (
            <button key={t} className={'tool ' + (tool === t ? 'tool-on' : '')} title={title} onClick={() => setTool(t)}>
              {icon}
            </button>
          ))}
        </div>
        <div className="tool-group">
          {colors.map((c) => (
            <button
              key={c}
              className={'h-[26px] w-[26px] rounded-full border-2 border-black/10 ' + (c === curColor ? 'outline-3 outline-offset-1 outline-accent' : '')}
              style={{ background: c }}
              onClick={() => (tool === 'hl' ? setHlColor(c) : setPenColor(c))}
            />
          ))}
        </div>
        <div className="tool-group">
          {SIZES.map((s, i) => (
            <button key={s.n} className={'tool ' + (i === sizeIdx ? 'tool-on' : '')} onClick={() => setSizeIdx(i)}>
              <span className="block rounded-full bg-current" style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
            </button>
          ))}
        </div>
        <div className="tool-group">
          <button className="tool" title="Undo" onClick={undo}>
            ↺
          </button>
          <button className="tool" title="Redo" onClick={redo}>
            ↻
          </button>
          <button className="tool" title="Clear ink" onClick={clearInk}>
            ✕
          </button>
        </div>
        <div className="tool-group">
          <button className="tool" title="Save the front as an image" onClick={exportFront}>
            ⤓
          </button>
          <button className="tool" title="Use an image as the card background" onClick={() => fileRef.current?.click()}>
            📷
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => importImage(e.target)} />
        </div>
      </div>

      {customOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]"
          onClick={(e) => e.target === e.currentTarget && setCustomOpen(false)}
        >
          <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
            <h2 className="m-0 mb-1 text-[17px] font-bold">✍️ Describe the image</h2>
            <p className="hint mb-3.5">
              I'll draw this instead of the answer. Your polish style from Settings still applies.
            </p>
            <textarea
              className="field-input min-h-20 resize-y"
              autoFocus
              placeholder="e.g. a water drop squeezing through a brick wall"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              data-testid="custom-prompt-input"
            />
            <div className="mt-3.5 flex gap-2.5">
              <button className="btn btn-primary" data-testid="custom-prompt-go" onClick={generateCustom}>
                ✨ Generate
              </button>
              <button className="btn btn-ghost" onClick={() => setCustomOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
