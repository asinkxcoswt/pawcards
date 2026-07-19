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

export interface Card {
  id: string
  deckId: string
  created: number
  updated?: number
  /** freehand ink on the front (drawn OVER the generated background) */
  front: Stroke[]
  /** legacy: pre-v1.7 cards could have ink on the back; editor no longer edits it */
  back: Stroke[]
  /** the answer / key takeaway; rendered as DOM text in review */
  backText: string
  /** last AI-generation subject (derived from backText) */
  subject?: string
  srs: Srs | null
  /** polished.front = AI-generated (or imported) background image dataURL */
  polished: { front?: string; back?: string }
}

export interface Deck {
  id: string
  name: string
  color: string
  created: number
  updated?: number
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
}

export interface Doc {
  version: 1
  decks: Deck[]
  cards: Card[]
  /** id -> deletion timestamp; lets deletes propagate through sync */
  tombstones: Record<string, number>
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
