import { create } from 'zustand'
import { DECK_COLORS, now, uuid } from './lib/constants'
import { loadDoc, memoryOnly, saveDoc } from './lib/db'
import { runPolish } from './lib/polish'
import { defaultDoc, defaultSettings, migrateSettings } from './lib/settings'
import { applyGrade, dueCards, isDue, unretire } from './lib/srs'
import { mergeRemote, syncConfigured, syncEndpoint } from './lib/sync'
import type { Card, Deck, Doc, Grade, PolishJob, ReviewSession, Settings } from './lib/types'

export type Screen = 'home' | 'deck' | 'editor' | 'review'

interface UiState {
  screen: Screen
  curDeckId: string | null
  curCardId: string | null
  session: ReviewSession | null
  polishJobs: PolishJob[]
  toast: { msg: string; at: number } | null
  syncing: boolean
  loaded: boolean
}

interface Actions {
  init: () => Promise<void>
  showToast: (msg: string) => void
  go: (screen: Screen) => void

  // decks
  createDeck: (name: string) => void
  renameDeck: (id: string, name: string) => void
  deleteDeck: (id: string) => void
  openDeck: (id: string) => void

  // cards
  newCard: () => Card
  openCard: (id: string) => void
  closeEditor: () => void
  deleteCard: (id: string) => void
  setBackText: (id: string, text: string) => void
  setFront: (id: string, strokes: Card['front']) => void
  setBackground: (id: string, dataUrl: string) => void
  clearBackground: (id: string) => void

  // AI generation
  requestPolish: (id: string) => 'queued' | 'no-answer' | 'no-key' | 'busy'

  // review
  startReview: (deckId: string | null) => boolean
  startCram: (deckId: string) => boolean
  flip: () => void
  grade: (g: Grade) => void
  endReview: () => void

  // settings / data
  saveSettings: (patch: Partial<Settings>) => void
  exportJson: () => string
  importJson: (json: string) => number
  wipe: () => void

  // sync
  syncNow: (auto: boolean) => Promise<void>
}

export type Store = Doc & UiState & Actions

/* ---------- persistence + sync scheduling (module-level side effects) ---------- */

let saveTimer: ReturnType<typeof setTimeout> | undefined
let syncTimer: ReturnType<typeof setTimeout> | undefined

function persist(get: () => Store) {
  const s = get()
  if (syncConfigured(s.settings)) {
    clearTimeout(syncTimer)
    syncTimer = setTimeout(() => get().syncNow(true), 30_000) // 30s after last change
  }
  if (memoryOnly) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { decks, cards, tombstones, settings } = get()
    void saveDoc({ version: 1, decks, cards, tombstones, settings })
  }, 400)
}

const touch = (c: Card): Card => ({ ...c, updated: now() })

export const useStore = create<Store>((set, get) => {
  /** update one card immutably + persist */
  const patchCard = (id: string, fn: (c: Card) => Card) => {
    set((s) => ({ cards: s.cards.map((c) => (c.id === id ? fn(c) : c)) }))
    persist(get)
  }
  const addTombstone = (ids: string[]) => {
    const t = now()
    set((s) => ({ tombstones: { ...s.tombstones, ...Object.fromEntries(ids.map((id) => [id, t])) } }))
  }

  return {
    ...defaultDoc(),
    screen: 'home',
    curDeckId: null,
    curCardId: null,
    session: null,
    polishJobs: [],
    toast: null,
    syncing: false,
    loaded: false,

    init: async () => {
      const doc = await loadDoc()
      if (doc) {
        const legacy = !(doc.settings && (doc.settings as Partial<Settings>).provider)
        set({
          decks: doc.decks ?? [],
          cards: doc.cards ?? [],
          tombstones: doc.tombstones ?? {},
          settings: migrateSettings({ ...defaultSettings(), ...doc.settings }, legacy),
        })
      }
      set({ loaded: true })
      if (memoryOnly) get().showToast('⚠️ Storage unavailable — changes won’t persist. Export often!')
      if (syncConfigured(get().settings)) void get().syncNow(true)
    },

    showToast: (msg) => set({ toast: { msg, at: now() } }),
    go: (screen) => set({ screen }),

    /* ---------- decks ---------- */
    createDeck: (name) => {
      const d: Deck = { id: uuid(), name, color: DECK_COLORS[get().decks.length % DECK_COLORS.length], created: now() }
      set((s) => ({ decks: [...s.decks, d], curDeckId: d.id, screen: 'deck' }))
      persist(get)
    },
    renameDeck: (id, name) => {
      set((s) => ({ decks: s.decks.map((d) => (d.id === id ? { ...d, name } : d)) }))
      persist(get)
    },
    deleteDeck: (id) => {
      const cardIds = get()
        .cards.filter((c) => c.deckId === id)
        .map((c) => c.id)
      addTombstone([...cardIds, id])
      set((s) => ({
        decks: s.decks.filter((d) => d.id !== id),
        cards: s.cards.filter((c) => c.deckId !== id),
        screen: 'home',
      }))
      persist(get)
    },
    openDeck: (id) => set({ curDeckId: id, screen: 'deck' }),

    /* ---------- cards ---------- */
    newCard: () => {
      const c: Card = {
        id: uuid(),
        deckId: get().curDeckId!,
        created: now(),
        updated: now(),
        front: [],
        back: [],
        backText: '',
        srs: null,
        polished: {},
      }
      set((s) => ({ cards: [...s.cards, c], curCardId: c.id, screen: 'editor' }))
      persist(get)
      return c
    },
    openCard: (id) => set({ curCardId: id, screen: 'editor' }),
    closeEditor: () => {
      const c = get().cards.find((x) => x.id === get().curCardId)
      // discard cards that are still completely empty (tombstoned in case they synced)
      if (c && !c.front.length && !c.back.length && !c.backText.trim() && !c.polished.front && !c.polished.back) {
        addTombstone([c.id])
        set((s) => ({ cards: s.cards.filter((x) => x.id !== c.id) }))
        persist(get)
      }
      set({ screen: 'deck' })
    },
    deleteCard: (id) => {
      addTombstone([id])
      set((s) => ({ cards: s.cards.filter((c) => c.id !== id), screen: 'deck' }))
      persist(get)
    },
    setBackText: (id, text) => patchCard(id, (c) => touch({ ...c, backText: text })),
    setFront: (id, strokes) => patchCard(id, (c) => touch({ ...c, front: strokes })),
    setBackground: (id, dataUrl) =>
      patchCard(id, (c) => touch({ ...c, polished: { ...c.polished, front: dataUrl } })),
    clearBackground: (id) =>
      patchCard(id, (c) => {
        const polished = { ...c.polished }
        delete polished.front
        return touch({ ...c, polished })
      }),

    /* ---------- AI generation (async queue, one job per card) ---------- */
    requestPolish: (id) => {
      const s = get()
      const c = s.cards.find((x) => x.id === id)
      if (!c) return 'busy'
      if (s.settings.provider !== 'local' && !s.settings.apiKey) return 'no-key'
      const answer = c.backText.trim()
      if (!answer) return 'no-answer'
      if (s.polishJobs.some((j) => j.cardId === id)) return 'busy'
      const subject = answer.replace(/\s+/g, ' ').slice(0, 160)
      patchCard(id, (cc) => touch({ ...cc, subject }))
      const job: PolishJob = { cardId: id, subject }
      set((st) => ({ polishJobs: [...st.polishJobs, job] }))
      void (async () => {
        try {
          const url = await runPolish(get().settings, subject)
          patchCard(id, (cc) => touch({ ...cc, polished: { ...cc.polished, front: url } }))
          get().showToast('✨ Image ready!')
        } catch (e) {
          get().showToast('Generate failed: ' + (e as Error).message)
        } finally {
          set((st) => ({ polishJobs: st.polishJobs.filter((j) => j !== job) }))
        }
      })()
      return 'queued'
    },

    /* ---------- review ---------- */
    startReview: (deckId) => {
      const q = dueCards(get().cards, deckId).map((c) => c.id)
      if (!q.length) return false
      set({
        session: { queue: q, i: 0, deckId, cram: false, flipped: false, done: 0, total: q.length },
        screen: 'review',
      })
      return true
    },
    startCram: (deckId) => {
      const q = get()
        .cards.filter((c) => c.deckId === deckId)
        .map((c) => c.id)
      if (!q.length) return false
      for (let i = q.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[q[i], q[j]] = [q[j], q[i]]
      }
      set({
        session: { queue: q, i: 0, deckId, cram: true, flipped: false, done: 0, total: q.length },
        screen: 'review',
      })
      return true
    },
    flip: () => set((s) => (s.session ? { session: { ...s.session, flipped: true } } : {})),
    grade: (g) => {
      const s = get()
      const sess = s.session
      if (!sess || !sess.flipped) return
      const cardId = sess.queue[sess.i]
      const c = s.cards.find((x) => x.id === cardId)
      if (c) {
        if (!sess.cram) {
          patchCard(cardId, (cc) => {
            const copy = { ...cc, srs: cc.srs ? { ...cc.srs } : null }
            applyGrade(copy, g)
            return touch(copy)
          })
        } else if (g === 0 && c.srs?.retired) {
          // shuffle-mode rescue: bring a retired card back into rotation
          patchCard(cardId, (cc) => {
            const copy = { ...cc, srs: cc.srs ? { ...cc.srs } : null }
            unretire(copy)
            return touch(copy)
          })
          get().showToast('Card is back in rotation')
        }
      }
      const queue = [...sess.queue]
      let total = sess.total
      if (!sess.cram && g === 0) {
        queue.push(cardId) // clear "Again" cards within the same session
        total++
      }
      const i = sess.i + 1
      const done = sess.done + 1
      if (i >= queue.length) {
        set({ session: null, screen: 'home' })
        get().showToast(`Session complete — ${done} card${done === 1 ? '' : 's'} reviewed 🎉`)
        return
      }
      set({ session: { ...sess, queue, total, i, done, flipped: false } })
    },
    endReview: () => set((s) => ({ session: null, screen: s.curDeckId ? 'deck' : 'home' })),

    /* ---------- settings / data ---------- */
    saveSettings: (patch) => {
      set((s) => ({ settings: { ...s.settings, ...patch } }))
      persist(get)
    },
    exportJson: () => {
      const { decks, cards, tombstones, settings } = get()
      return JSON.stringify({ version: 1, decks, cards, tombstones, settings })
    },
    importJson: (json) => {
      const doc = JSON.parse(json) as Doc
      if (!doc || !Array.isArray(doc.decks) || !Array.isArray(doc.cards)) throw new Error('not a PawCards backup')
      set((s) => {
        const decks = [...s.decks]
        for (const d of doc.decks) if (!decks.some((x) => x.id === d.id)) decks.push(d)
        const cards = [...s.cards]
        for (const c of doc.cards) {
          const i = cards.findIndex((x) => x.id === c.id)
          if (i >= 0) cards[i] = c
          else cards.push(c)
        }
        return { decks, cards }
      })
      persist(get)
      return doc.cards.length
    },
    wipe: () => {
      set({ ...defaultDoc(), screen: 'home', curDeckId: null, curCardId: null, session: null })
      persist(get)
    },

    /* ---------- cloud sync: pull → merge → push ---------- */
    syncNow: async (auto) => {
      const st = get()
      if (!syncConfigured(st.settings) || st.syncing) return
      set({ syncing: true })
      clearTimeout(syncTimer)
      try {
        const ep = syncEndpoint(st.settings.syncUrl, st.settings.syncId)
        const rsp = await fetch(ep)
        if (rsp.ok) {
          const remote = await rsp.json()
          if (remote?.doc) {
            const merged = mergeRemote(
              { decks: get().decks, cards: get().cards, tombstones: get().tombstones },
              remote.doc,
            )
            set(merged)
          }
        } else if (rsp.status !== 404) {
          const e = await rsp.json().catch(() => ({}) as { error?: string })
          throw new Error(e.error ?? 'HTTP ' + rsp.status)
        }
        const { decks, cards, tombstones } = get()
        const put = await fetch(ep, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doc: { version: 1, decks, cards, tombstones } }),
        })
        if (!put.ok) {
          const e = await put.json().catch(() => ({}) as { error?: string })
          throw new Error(e.error ?? 'HTTP ' + put.status)
        }
        set((s) => ({ settings: { ...s.settings, lastSyncAt: now() } }))
        persist(get)
        if (!auto) get().showToast('☁ Synced')
      } catch (err) {
        if (!auto) get().showToast('Sync failed: ' + (err as Error).message)
      } finally {
        set({ syncing: false })
      }
    },
  }
})

// test hook: e2e specs drive the store directly for setup/assertions
if (typeof window !== 'undefined') {
  ;(window as unknown as { __store: typeof useStore }).__store = useStore
}

/* selectors */
export const selDueCount = (s: Store) => dueCards(s.cards, null).length
export const selDeckCards = (deckId: string) => (s: Store) => s.cards.filter((c) => c.deckId === deckId)
export { isDue }
