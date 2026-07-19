import { useState } from 'react'
import { selDueCount, useStore } from '../store'
import { dueCards } from '../lib/srs'
import DeckModal from './DeckModal'
import ImportShareModal from './ImportShareModal'
import SettingsModal from './SettingsModal'

export default function Home() {
  const decks = useStore((s) => s.decks)
  const cards = useStore((s) => s.cards)
  const due = useStore(selDueCount)
  const openDeck = useStore((s) => s.openDeck)
  const createDeck = useStore((s) => s.createDeck)
  const startReview = useStore((s) => s.startReview)
  const [showNewDeck, setShowNewDeck] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showImport, setShowImport] = useState(false)

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <span className="text-xl">🐾</span>
        <h1 className="m-0 flex-1 truncate text-[19px] font-bold tracking-tight">PawCards</h1>
        <button className="iconbtn" title="Import a shared deck" data-testid="import-share" onClick={() => setShowImport(true)}>
          🤝
        </button>
        <button className="iconbtn" title="Settings" onClick={() => setShowSettings(true)}>
          ⚙︎
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <div className="mb-4.5 flex items-center gap-3 rounded-[14px] bg-ink p-4 text-white shadow-soft">
          <div>
            <div className="text-[26px] font-extrabold leading-none" data-testid="due-count">
              {due}
            </div>
            <div className="text-xs opacity-75">cards due</div>
          </div>
          <div className="flex-1" />
          <button className="btn btn-accent" disabled={due === 0} onClick={() => startReview(null)}>
            Review ▸
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {decks.length === 0 && (
            <div className="col-span-full py-12 text-center text-sm leading-relaxed text-muted">
              Welcome! 🐾
              <br />
              Create a deck for something you're learning,
              <br />
              then draw your first card.
            </div>
          )}
          {decks.map((d) => {
            const deckCards = cards.filter((c) => c.deckId === d.id)
            const deckDue = dueCards(deckCards, null).length
            return (
              <button
                key={d.id}
                className="relative flex min-h-24 flex-col justify-end gap-0.5 overflow-hidden rounded-[14px] border border-line bg-panel p-3.5 text-left shadow-soft"
                onClick={() => openDeck(d.id)}
              >
                <span className="absolute left-3.5 top-3.5 h-3 w-3 rounded" style={{ background: d.color }} />
                {deckDue > 0 && (
                  <span className="absolute right-3 top-3 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-white">
                    {deckDue} due
                  </span>
                )}
                <span className="truncate text-[15px] font-bold">{d.name}</span>
                <span className="text-xs text-muted">
                  {deckCards.length} card{deckCards.length === 1 ? '' : 's'}
                  {d.sharedBy ? ` · 🤝 ${d.sharedBy}` : ''}
                </span>
              </button>
            )
          })}
          <button
            className="flex min-h-24 items-center justify-center rounded-[14px] border border-dashed border-line text-sm font-semibold text-muted"
            onClick={() => setShowNewDeck(true)}
          >
            ＋ New deck
          </button>
        </div>
      </main>

      {showNewDeck && (
        <DeckModal
          title="New deck"
          submitLabel="Create"
          onSubmit={(name) => {
            createDeck(name)
            setShowNewDeck(false)
          }}
          onClose={() => setShowNewDeck(false)}
        />
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showImport && <ImportShareModal onClose={() => setShowImport(false)} />}
    </section>
  )
}
