import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useStore } from '../store'
import { dueCards, fmtIv, isDue } from '../lib/srs'
import { now } from '../lib/constants'
import { sortDeckCards } from '../lib/order'
import { syncConfigured } from '../lib/sync'
import type { Card } from '../lib/types'
import CardPreviewModal from './CardPreviewModal'
import CardThumb from './CardThumb'
import ConfirmButton from './ConfirmButton'
import DeckModal from './DeckModal'
import MoveCardsModal from './MoveCardsModal'
import ReviewAllModal from './ReviewAllModal'
import ShareDeckModal from './ShareDeckModal'
import Icon from './Icon'

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
  const reorderCard = useStore((s) => s.reorderCard)
  const setCardsPrivate = useStore((s) => s.setCardsPrivate)
  const moveCards = useStore((s) => s.moveCards)
  const showToast = useStore((s) => s.showToast)
  const settings = useStore((s) => s.settings)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  /** normal browsing · multi-select (move / privacy) · pick-a-card-to-review */
  const [mode, setMode] = useState<'normal' | 'select' | 'pick'>('normal')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [reviewMenu, setReviewMenu] = useState(false)
  const [reviewAll, setReviewAll] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const selecting = mode === 'select'

  // mouse needs a small drag threshold so a click still opens the card; touch
  // uses a long-press so swiping still scrolls the grid. Keyboard = accessible.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!deck) return null
  const due = dueCards(cards, null).length
  const sorted = sortDeckCards(allCards, deckId)
  const privateCount = cards.filter((c) => c.private).length
  const dragging = dragId ? sorted.find((c) => c.id === dragId) : null

  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const to = sorted.findIndex((c) => c.id === over.id)
    if (to >= 0) reorderCard(deckId, String(active.id), to)
  }

  const startAll = (opts: { count: number; shuffle: boolean }) => {
    setReviewAll(false)
    if (!startCram(deckId, opts)) showToast('No cards in this deck yet')
  }

  const exitMode = () => {
    setMode('normal')
    setSelected(new Set())
  }
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectedIds = [...selected]
  const allSelectedPrivate = selectedIds.length > 0 && selectedIds.every((id) => cards.find((c) => c.id === id)?.private)
  const previewCard = previewId ? cards.find((c) => c.id === previewId) : null

  const onCardTap = (id: string) => {
    if (mode === 'select') toggleSelected(id)
    else if (mode === 'pick') setPreviewId(id)
    else openCard(id)
  }

  return (
    <section className="flex h-dvh flex-col overflow-hidden">
      {mode !== 'normal' ? (
        <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <h1 className="m-0 flex flex-1 items-center gap-1.5 truncate text-[17px] font-bold tracking-tight">
            {selecting ? (
              <>
                <Icon name="select" size={16} /> {selected.size ? `${selected.size} selected` : 'Select cards'}
              </>
            ) : (
              <>
                <Icon name="play" size={16} /> Pick a card to review
              </>
            )}
          </h1>
          <button className="btn btn-primary" data-testid="select-done" onClick={exitMode}>
            Done
          </button>
        </header>
      ) : (
        <header className="flex items-center gap-2.5 px-4 pb-2.5" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 10px)' }}>
          <button className="iconbtn" data-testid="back" title="Back" onClick={() => go('home')}>
            <Icon name="back" size={22} />
          </button>
          <h1 className="m-0 flex flex-1 items-center gap-2 truncate text-[19px] font-bold tracking-tight">
            <span className="truncate">{deck.name}</span>
            {deck.sharedBy && (
              <span className="flex items-center gap-1 text-[12px] font-semibold text-muted">
                <Icon name="friends" size={13} /> {deck.sharedBy}
              </span>
            )}
          </h1>
          {cards.length > 0 && (
            <button className="iconbtn" title="Select cards to move or keep private" data-testid="select-mode" onClick={() => setMode('select')}>
              <Icon name="select" />
            </button>
          )}
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
            <Icon name="share" />
          </button>
          <button className="iconbtn" title="Rename" onClick={() => setRenaming(true)}>
            <Icon name="rename" />
          </button>
          <ConfirmButton
            className="iconbtn text-again"
            label={<Icon name="delete" />}
            armedLabel={<Icon name="delete" size={20} strokeWidth={2.6} />}
            title="Delete deck"
            onConfirm={() => deleteDeck(deckId)}
            toastMsg="Tap again to confirm delete"
          />
        </header>
      )}

      <main className="flex-1 overflow-y-auto px-4 pt-1" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        {mode === 'pick' ? (
          <div className="my-3.5 rounded-xl bg-accentsoft px-3.5 py-2.5 text-[13px] font-semibold text-ink">
            Tap any card to review it, then close and pick another — nothing is graded or rescheduled.
          </div>
        ) : selecting ? (
          <div className="my-3.5 flex flex-wrap items-center gap-2">
            {/* the count lives in the header — here just a nudge when nothing is picked yet */}
            <span className="mr-auto text-[13px] font-semibold text-muted">
              {selected.size ? '' : 'Tap cards to select'}
              {privateCount > 0 && <span className="font-normal">{selected.size ? '' : ' · '}{privateCount} private 🔒</span>}
            </span>
            <button
              className="btn"
              data-testid="move-cards"
              disabled={!selected.size}
              onClick={() => setMoving(true)}
            >
              <Icon name="move" size={15} /> Move to…
            </button>
            <button
              className="btn"
              data-testid="toggle-private"
              disabled={!selected.size}
              onClick={() => {
                setCardsPrivate(selectedIds, !allSelectedPrivate)
                showToast(
                  allSelectedPrivate
                    ? `${selectedIds.length} card${selectedIds.length === 1 ? '' : 's'} shared again`
                    : `🔒 ${selectedIds.length} card${selectedIds.length === 1 ? '' : 's'} kept out of shares`,
                )
              }}
            >
              <Icon name="lock" size={15} /> {allSelectedPrivate ? 'Make shareable' : 'Make private'}
            </button>
          </div>
        ) : (
          <div className="my-3.5 flex gap-2.5">
            <button className="btn btn-primary" data-testid="new-card" onClick={() => newCard()}>
              <Icon name="plus" size={16} /> New card
            </button>
            {/* split button — main action is the scheduled session when cards
                are due, otherwise "Review all"; the caret always offers the
                other ways to study */}
            <div className="relative inline-flex">
              {due > 0 ? (
                <button className="btn btn-accent rounded-r-none" data-testid="review-due" onClick={() => startReview(deckId)}>
                  Review ({due})
                </button>
              ) : (
                <button
                  className="btn rounded-r-none"
                  data-testid="review-all"
                  disabled={!cards.length}
                  onClick={() => setReviewAll(true)}
                >
                  <Icon name="play" size={16} /> Review all
                </button>
              )}
              <button
                className={'btn -ml-px rounded-l-none px-2 ' + (due > 0 ? 'btn-accent' : '')}
                data-testid="review-menu"
                aria-label="Review options"
                disabled={!cards.length}
                onClick={() => setReviewMenu((v) => !v)}
              >
                <Icon name="caret" size={16} />
              </button>
              {reviewMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setReviewMenu(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-max rounded-xl border border-line bg-panel p-1 shadow-soft">
                    {due > 0 && (
                      <button
                        className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper"
                        data-testid="review-all-opt"
                        onClick={() => {
                          setReviewMenu(false)
                          setReviewAll(true)
                        }}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <Icon name="play" size={15} /> Review all cards…
                        </span>
                      </button>
                    )}
                    <button
                      className="block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-paper"
                      data-testid="review-pick-opt"
                      onClick={() => {
                        setReviewMenu(false)
                        setMode('pick')
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Icon name="select" size={15} /> Pick cards to review
                      </span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted">No cards yet — draw your first one!</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e: DragStartEvent) => setDragId(String(e.active.id))}
            onDragCancel={() => setDragId(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={sorted.map((c) => c.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
                {sorted.map((c) => (
                  <SortableCard
                    key={c.id}
                    card={c}
                    mode={mode}
                    checked={selected.has(c.id)}
                    onClick={() => onCardTap(c.id)}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {dragging ? (
                <div className="overflow-hidden rounded-xl border border-accent bg-panel opacity-95 shadow-lg">
                  <CardThumb card={dragging} />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {previewCard && (
        <CardPreviewModal card={previewCard} title="Review" onClose={() => setPreviewId(null)} />
      )}
      {moving && (
        <MoveCardsModal
          count={selected.size}
          fromDeckId={deckId}
          onClose={() => setMoving(false)}
          onMove={(toDeckId) => {
            const n = selected.size
            const target = useStore.getState().decks.find((d) => d.id === toDeckId)
            moveCards(selectedIds, toDeckId)
            setMoving(false)
            exitMode()
            showToast(`Moved ${n} card${n === 1 ? '' : 's'} to “${target?.name ?? 'deck'}”`)
          }}
        />
      )}
      {reviewAll && <ReviewAllModal total={cards.length} onStart={startAll} onClose={() => setReviewAll(false)} />}
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

/** One card tile — draggable to reorder while browsing; a tap target in the
 *  select / pick modes (where dragging is off). */
function SortableCard({
  card,
  mode,
  checked,
  onClick,
}: {
  card: Card
  mode: 'normal' | 'select' | 'pick'
  checked: boolean
  onClick: () => void
}) {
  const idle = mode === 'normal'
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    disabled: !idle,
  })
  // outside browsing the tile is a plain button — dnd-kit's attributes would mark
  // it aria-disabled, which reads as "not clickable" to screen readers
  const dragProps = idle ? { ...attributes, ...listeners } : {}
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...dragProps}
      aria-pressed={mode === 'select' ? checked : undefined}
      className={
        'relative touch-manipulation overflow-hidden rounded-xl border bg-panel text-left shadow-soft transition ' +
        (checked ? 'border-accent ring-2 ring-accent ' : card.private ? 'border-accent ' : 'border-line ') +
        (card.private && !checked ? 'opacity-60' : '')
      }
      data-testid={(mode === 'select' ? 'select-card-' : 'card-') + card.id}
      onClick={onClick}
    >
      {mode === 'select' && (
        <span
          className={
            'absolute right-2 top-1.5 z-[6] flex h-5 w-5 items-center justify-center rounded-full border ' +
            (checked ? 'border-accent bg-accent text-white' : 'border-line bg-white/85 text-transparent')
          }
          data-testid={'check-' + card.id}
        >
          <Icon name="check" size={12} strokeWidth={3} />
        </span>
      )}
      <CardThumb card={card} />
      <span className="absolute bottom-1.5 right-2 rounded-full bg-white/85 px-1.5 py-0.5 text-[10px] font-bold text-muted">
        {!card.srs ? 'new' : card.srs.retired ? '✓ done' : isDue(card) ? 'due' : 'in ' + fmtIv(card.srs.due - now())}
      </span>
      {card.private && (
        <span className="absolute left-2 top-1.5 flex rounded-full bg-white/85 p-1 text-ink" data-testid={'private-badge-' + card.id}>
          <Icon name="lock" size={12} />
        </span>
      )}
      {card.polished.front && (
        <span className="absolute right-2 top-1.5 flex rounded-full bg-white/85 p-1 text-accent">
          <Icon name="generate" size={12} />
        </span>
      )}
    </button>
  )
}
