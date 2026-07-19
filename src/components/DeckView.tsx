import { useState } from 'react'
import { useStore } from '../store'
import { dueCards, fmtIv, isDue } from '../lib/srs'
import { now } from '../lib/constants'
import { syncConfigured } from '../lib/sync'
import CardThumb from './CardThumb'
import ConfirmButton from './ConfirmButton'
import DeckModal from './DeckModal'
import ShareDeckModal from './ShareDeckModal'

export default function DeckView() {
  const deckId = useStore((s) => s.curDeckId)!
  const deck = useStore((s) => s.decks.find((d) => d.id === deckId))
  const allCards = useStore((s) => s.cards) // NB: zustand v5 selectors must return stable refs — derive below
  const cards = allCards.filter((c) => c.deckId === deckId)
  const go = useStore((s) => s.go)
  const newCard = useStore((s) => s.newCard)
  const openCard = useStore((s) => s.openCard)
  const renameDeck = useStore((s) => s.renameDeck)
  const deleteDeck = useStore((s) => s.deleteDeck)
  const startReview = useStore((s) => s.startReview)
  const startCram = useStore((s) => s.startCram)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)

  if (!deck) return null
  const due = dueCards(cards, null).length
  const sorted = [...cards].sort((a, b) => b.created - a.created)

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
        <button className="iconbtn" onClick={() => go('home')}>
          ‹
        </button>
        <h1 className="m-0 flex-1 truncate text-[19px] font-bold tracking-tight">
          {deck.name}
          {deck.sharedBy && <span className="ml-2 text-[12px] font-semibold text-muted">🤝 {deck.sharedBy}</span>}
        </h1>
        <button
          className="iconbtn"
          title="Share this deck with friends"
          data-testid="share-deck"
          onClick={() => {
            if (!cards.length) {
              showToast('Nothing to share yet — add a card first')
              return
            }
            if (!syncConfigured(settings)) {
              showToast('Set up your Worker in Settings → Cloud sync first')
              return
            }
            setSharing(true)
          }}
        >
          🤝
        </button>
        <button className="iconbtn" title="Rename" onClick={() => setRenaming(true)}>
          ✎
        </button>
        <ConfirmButton className="iconbtn" label="🗑" title="Delete deck" onConfirm={() => deleteDeck(deckId)} toastMsg="Tap again to confirm delete" />
      </header>

      <main className="flex-1 overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <div className="my-3.5 flex gap-2.5">
          <button className="btn btn-primary" onClick={() => newCard()}>
            ＋ New card
          </button>
          <button className="btn" disabled={!due} onClick={() => startReview(deckId)}>
            {due ? `Review (${due})` : 'Nothing due'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!startCram(deckId)) showToast('No cards in this deck yet')
            }}
          >
            Shuffle all
          </button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {sorted.length === 0 && <div className="col-span-full py-12 text-center text-sm text-muted">No cards yet — draw your first one!</div>}
          {sorted.map((c) => (
            <button
              key={c.id}
              className="relative overflow-hidden rounded-xl border border-line bg-panel text-left shadow-soft"
              onClick={() => openCard(c.id)}
            >
              <CardThumb card={c} />
              <span className="absolute bottom-1.5 right-2 rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-muted">
                {!c.srs ? 'new' : c.srs.retired ? '✓ done' : isDue(c) ? 'due' : 'in ' + fmtIv(c.srs.due - now())}
              </span>
              {c.polished.front && <span className="absolute right-2 top-1.5 text-[11px]">✨</span>}
            </button>
          ))}
        </div>
      </main>

      {sharing && <ShareDeckModal deckId={deckId} onClose={() => setSharing(false)} />}
      {renaming && (
        <DeckModal
          title="Rename deck"
          submitLabel="Save"
          initial={deck.name}
          onSubmit={(name) => {
            renameDeck(deckId, name)
            setRenaming(false)
          }}
          onClose={() => setRenaming(false)}
        />
      )}
    </section>
  )
}
