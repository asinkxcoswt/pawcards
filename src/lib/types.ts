export interface Pt {
  x: number
  y: number
}

export interface Stroke {
  tool: 'pen' | 'hl'
  color: string
  size: number
  pts: Pt[]
}

export interface Srs {
  ease: number
  interval: number
  reps: number
  lapses: number
  due: number
  /** Easy = "I know this, never show it again" */
  retired?: boolean
}

/** a single optional caption on the card Front (full width, movable vertically) */
export interface FrontText {
  text: string
  /** box top as a fraction of card height (0..1); box is full width */
  y: number
  /** font size in logical CARD_W(800) space px */
  size: number
  color: string
  align: 'left' | 'center' | 'right'
  /** background colour, or 'none' for transparent */
  bg: string
  /** background opacity 0..1 (ignored when bg === 'none') */
  bgAlpha: number
}

export interface Card {
  id: string
  deckId: string
  created: number
  updated?: number
  /** freehand ink on the front (drawn OVER the generated background) */
  front: Stroke[]
  /** optional caption on the front (drawn OVER ink) */
  frontText?: FrontText
  /** legacy: pre-v1.7 cards could have ink on the back; editor no longer edits it */
  back: Stroke[]
  /** the answer / key takeaway; rendered as DOM text in review */
  backText: string
  /** last AI-generation subject (derived from backText) */
  subject?: string
  /** manual sort position within the deck (drag & drop). Absent = fall back to
   *  newest-first by `created` — see lib/order.ts */
  order?: number
  /** kept out of every share (deck QR + rooms); still yours to review */
  private?: boolean
  srs: Srs | null
  /** polished.front = AI-generated (or imported) background image: either an
   *  inline dataURL (local-only / awaiting upload) or an `img:<id>` ref to a
   *  blob on the sync worker (lib/images.ts) */
  polished: { front?: string; back?: string }
}

export interface Deck {
  id: string
  name: string
  color: string
  created: number
  updated?: number
  /** nickname of the friend who shared this deck (absent on your own decks) */
  sharedBy?: string
}

export type Provider = 'local' | 'gemini' | 'openai'

export interface Settings {
  provider: Provider
  apiKey: string
  /** generation endpoint; for 'local' this is the Worker / A1111 URL incl. ?key= */
  apiUrl: string
  model: string
  strength: number
  /** the polish STYLE (subject is prepended per card) */
  prompt: string
  syncUrl: string
  syncId: string
  lastSyncAt: number
  /** shown to friends on decks you share; asked on first share */
  nickname: string
  /** host preference: cards to draw per group review (0 = all shared cards) */
  roomReviewCount: number
  /** the first-run welcome popup has been answered (scan or skip) */
  onboarded: boolean
  /** visual theme (per-device) */
  theme: 'ink' | 'paper'
}

/**
 * A workshop room the user created or joined. Lives in the synced doc so
 * every device of the user can revisit it; the room's live content (shared
 * decks, members) stays in KV on the room creator's worker (`url`).
 */
export interface RoomRef {
  /** room-xxxx-xxxx — also the KV id of the room doc on `url` */
  code: string
  /** room creator's worker sync URL incl ?key= */
  url: string
  name: string
  /** host display name (from the invite; shown in join prompts) */
  by?: string
  /** host let guests use the server (generation/sync)? invites then carry a full
   *  temp key; default/undefined = room-only key (guests can't use the server) */
  shareServer?: boolean
  /** ms epoch — hard expiry of the room (or its workshop server); expired rooms hide */
  expiresAt?: number
  /** this user's member entry id in the room (stable across rejoins) */
  memberId: string
  joinedAt: number
  updated?: number
}

export interface Doc {
  version: 1
  decks: Deck[]
  cards: Card[]
  /** id -> deletion timestamp; lets deletes propagate through sync */
  tombstones: Record<string, number>
  rooms: RoomRef[]
  settings: Settings
}

export type Grade = 0 | 1 | 2 | 3 // Again | Hard | Good | Easy(retire)

export interface ReviewSession {
  queue: string[] // card ids
  i: number
  deckId: string | null
  cram: boolean
  flipped: boolean
  done: number
  total: number
}

export interface PolishJob {
  cardId: string
  subject: string
}
