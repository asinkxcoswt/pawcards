export const APP_VERSION = '3.8.0'

/** logical card coordinate space (8:5) — strokes are stored in these units */
export const CARD_W = 800
export const CARD_H = 500

export const MIN_MS = 60_000
export const DAY_MS = 86_400_000

/** self-hosting guide (Cloudflare setup + worker deploy). TODO: point at the real repo path. */
export const SETUP_GUIDE_URL = 'https://github.com/asinkxcoswt/pawcards/blob/main/docs/SELF_HOSTING.md'

export const DECK_COLORS = ['#e0663c', '#3d7dbb', '#3f8f5f', '#c98a2b', '#8b5fb2', '#c04b3a', '#2f8f8f', '#6b7280']
export const PEN_COLORS = ['#22211f', '#6b7280', '#c04b3a', '#e0663c', '#c98a2b', '#3f8f5f', '#3d7dbb', '#8b5fb2']
export const HL_COLORS = ['#f7e463', '#8be28b', '#8ecbf5', '#f5a3c0']
export const SIZES = [
  { n: 'S', v: 3 },
  { n: 'M', v: 6 },
  { n: 'L', v: 14 },
] as const

export const uuid = (): string =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Date.now() + '-' + Math.floor(Math.random() * 1e9)

export const now = () => Date.now()
