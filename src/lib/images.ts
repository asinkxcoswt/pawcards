import { CARD_H, CARD_W, uuid } from './constants'
import { imgCacheGet, imgCachePut } from './db'
import { syncConfigured } from './sync'
import type { Card, Settings } from './types'

/**
 * Card image blobs — the sync doc stays small because `polished.front`
 * holds either a legacy data URL (local-only / not-yet-uploaded) or a
 * reference `img:<id>` to a blob stored on the sync Worker's KV
 * (`/img` endpoint, one binary entry per image).
 *
 * Lifecycle: generation/import stores a data URL (instant display) →
 * the uploader pass compresses it to WebP/JPEG at card resolution,
 * PUTs it, and rewrites the card to the ref → other devices sync the
 * tiny ref and lazily fetch the blob once, caching it in IndexedDB.
 * Orphaned blobs (regenerate / ✕ image / deleted card) are collected
 * by the Worker's /img-gc using the referenced-id keep-list.
 */

export const IMG_REF_PREFIX = 'img:'

export function isImgRef(s: string | undefined): s is string {
  return !!s && s.startsWith(IMG_REF_PREFIX)
}

export const imgIdOf = (ref: string): string => ref.slice(IMG_REF_PREFIX.length)

type SyncConf = Pick<Settings, 'syncUrl' | 'syncId'>

/** blob endpoint on the sync worker (same ?key= auth as /sync) */
export function imgEndpoint(s: SyncConf, imgId: string): string {
  const u = new URL(s.syncUrl)
  const key = u.searchParams.get('key') ?? ''
  return (
    u.origin +
    '/img?key=' + encodeURIComponent(key) +
    '&id=' + encodeURIComponent(s.syncId) +
    '&img=' + encodeURIComponent(imgId)
  )
}

export function imgGcEndpoint(s: SyncConf): string {
  const u = new URL(s.syncUrl)
  const key = u.searchParams.get('key') ?? ''
  return u.origin + '/img-gc?key=' + encodeURIComponent(key) + '&id=' + encodeURIComponent(s.syncId)
}

/* ---------- pure helpers over the card list (unit-tested) ---------- */

/** cards whose front image is still an inline data URL (awaiting upload) */
export function pendingUploadCards(cards: Card[]): Card[] {
  return cards.filter((c) => c.polished?.front?.startsWith('data:'))
}

/** every img id the doc references — the GC keep-list */
export function referencedImgIds(cards: Card[]): Set<string> {
  const ids = new Set<string>()
  for (const c of cards) {
    if (isImgRef(c.polished?.front)) ids.add(imgIdOf(c.polished.front))
    if (isImgRef(c.polished?.back)) ids.add(imgIdOf(c.polished.back))
  }
  return ids
}

/* ---------- settings access (registered by the store; avoids an import cycle) ---------- */

let getSettings: (() => Settings) | null = null
export function configureImages(fn: () => Settings): void {
  getSettings = fn
}

/* ---------- resolution: ref → displayable URL ---------- */

const memUrl = new Map<string, string>() // ref → object URL (session-lived)
const inflight = new Map<string, Promise<string | null>>()
const lastFail = new Map<string, number>()
const RETRY_MS = 30_000

/** synchronous lookup for paint paths; undefined = not loaded yet */
export function imgUrlSync(ref: string): string | undefined {
  return memUrl.get(ref)
}

async function fetchBlob(ref: string): Promise<Blob | null> {
  const id = imgIdOf(ref)
  const cached = await imgCacheGet(id)
  if (cached) return cached
  const s = getSettings?.()
  if (!s || !syncConfigured(s)) return null
  const rsp = await fetch(imgEndpoint(s, id))
  if (!rsp.ok) return null
  const blob = await rsp.blob()
  void imgCachePut(id, blob)
  return blob
}

/** load a ref into the memory cache (IndexedDB → network); null on failure */
export function loadImg(ref: string): Promise<string | null> {
  const hit = memUrl.get(ref)
  if (hit) return Promise.resolve(hit)
  const pending = inflight.get(ref)
  if (pending) return pending
  const failedAt = lastFail.get(ref)
  if (failedAt && Date.now() - failedAt < RETRY_MS) return Promise.resolve(null)
  const p = (async () => {
    const blob = await fetchBlob(ref)
    if (!blob) {
      lastFail.set(ref, Date.now())
      return null
    }
    lastFail.delete(ref)
    const url = URL.createObjectURL(blob)
    memUrl.set(ref, url)
    return url
  })()
    .catch(() => {
      lastFail.set(ref, Date.now())
      return null
    })
    .finally(() => inflight.delete(ref))
  inflight.set(ref, p)
  return p
}

/* ---------- compression + upload ---------- */

/** re-encode at card resolution (cover fit); WebP where the browser can, else JPEG */
export async function compressImage(dataUrl: string): Promise<Blob> {
  const im = new Image()
  im.src = dataUrl
  await new Promise((res, rej) => {
    im.onload = res
    im.onerror = () => rej(new Error('image failed to decode'))
  })
  const cv = document.createElement('canvas')
  cv.width = CARD_W
  cv.height = CARD_H
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff' // JPEG has no alpha — flatten like the card does
  ctx.fillRect(0, 0, CARD_W, CARD_H)
  const s = Math.max(CARD_W / im.naturalWidth, CARD_H / im.naturalHeight)
  const dw = im.naturalWidth * s
  const dh = im.naturalHeight * s
  ctx.drawImage(im, (CARD_W - dw) / 2, (CARD_H - dh) / 2, dw, dh)
  const toBlob = (type: string, q: number) =>
    new Promise<Blob | null>((res) => cv.toBlob(res, type, q))
  let blob = await toBlob('image/webp', 0.82)
  // Safari answers 'image/webp' with a PNG — fall back to JPEG there
  if (!blob || blob.type !== 'image/webp') blob = await toBlob('image/jpeg', 0.85)
  if (!blob) throw new Error('image encode failed')
  return blob
}

/** compress + PUT one image; returns the `img:<id>` ref (also primes local caches) */
export async function uploadImage(s: SyncConf, dataUrl: string): Promise<string> {
  const blob = await compressImage(dataUrl)
  const id = uuid()
  const rsp = await fetch(imgEndpoint(s, id), {
    method: 'PUT',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!rsp.ok) {
    const e = await rsp.json().catch(() => ({}) as { error?: string })
    throw new Error(e.error ?? 'HTTP ' + rsp.status)
  }
  void imgCachePut(id, blob)
  const ref = IMG_REF_PREFIX + id
  memUrl.set(ref, URL.createObjectURL(blob))
  return ref
}

/* ---------- inlining: ref → data URL (backup export, deck shares) ---------- */

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(new Error('read failed'))
    r.readAsDataURL(blob)
  })
}

/**
 * Replace img refs with data URLs so the result is self-contained —
 * backups must survive a worker change, and share recipients use a
 * DIFFERENT worker that can't resolve our refs. Unresolvable refs
 * (offline, blob gone) are left in place and counted in `missing`.
 */
export async function inlineCardImages(cards: Card[]): Promise<{ cards: Card[]; missing: number }> {
  let missing = 0
  const out: Card[] = []
  for (const c of cards) {
    const front = c.polished?.front
    if (!isImgRef(front)) {
      out.push(c)
      continue
    }
    const blob = await fetchBlob(front).catch(() => null)
    if (!blob) {
      missing++
      out.push(c)
      continue
    }
    out.push({ ...c, polished: { ...c.polished, front: await blobToDataUrl(blob) } })
  }
  return { cards: out, missing }
}

/* ---------- GC ---------- */

/** ask the worker to drop unreferenced blobs (it enforces a 7-day age guard) */
export async function runImgGc(s: SyncConf, keep: Set<string>): Promise<void> {
  await fetch(imgGcEndpoint(s), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keep: [...keep] }),
  })
}
