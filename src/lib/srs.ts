import { DAY_MS, MIN_MS, now } from './constants'
import type { Card, Grade, Srs } from './types'

/**
 * SM-2-flavoured spaced repetition.
 * Grades: 0 Again · 1 Hard · 2 Good · 3 Easy.
 * By product decision, Easy RETIRES the card ("I know this — never again");
 * a retired card can be rescued in Shuffle (cram) mode by grading Again.
 */

export function newSrs(t = now()): Srs {
  return { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: t }
}

export function isDue(c: Card, t = now()): boolean {
  return !c.srs || (!c.srs.retired && c.srs.due <= t)
}

export function dueCards(cards: Card[], deckId: string | null, t = now()): Card[] {
  return cards
    .filter((c) => (deckId ? c.deckId === deckId : true) && isDue(c, t))
    .sort((a, b) => (a.srs ? a.srs.due : 0) - (b.srs ? b.srs.due : 0))
}

export function previewIntervals(c: Card) {
  const s = c.srs ?? newSrs()
  return {
    again: 10 * MIN_MS,
    hard: s.reps === 0 ? 30 * MIN_MS : Math.max(DAY_MS, s.interval * 1.2),
    good: s.reps === 0 ? DAY_MS : s.reps === 1 ? 3 * DAY_MS : s.interval * s.ease,
    easy: 0, // retires — no interval
  }
}

/** Mutates c.srs in place (call inside a store action). */
export function applyGrade(c: Card, g: Grade, t = now()): void {
  if (!c.srs) c.srs = newSrs(t)
  const s = c.srs
  const iv = previewIntervals(c)
  if (g === 0) {
    s.reps = 0
    s.lapses++
    s.ease = Math.max(1.3, s.ease - 0.2)
    s.interval = 0
    s.due = t + iv.again
    return
  }
  if (g === 1) {
    s.ease = Math.max(1.3, s.ease - 0.15)
    s.interval = iv.hard
  }
  if (g === 2) s.interval = iv.good
  if (g === 3) {
    s.retired = true // Easy = done forever
    s.interval = 0
  }
  s.reps++
  s.due = t + s.interval
}

/** Shuffle-mode rescue: "Again" on a retired card puts it back in rotation. */
export function unretire(c: Card, t = now()): void {
  if (!c.srs) return
  c.srs.retired = false
  c.srs.reps = 0
  c.srs.interval = 0
  c.srs.due = t
}

export function fmtIv(ms: number): string {
  if (ms < 90 * MIN_MS) return Math.max(1, Math.round(ms / MIN_MS)) + 'm'
  if (ms < DAY_MS) return Math.round(ms / (60 * MIN_MS)) + 'h'
  if (ms < 30 * DAY_MS) return Math.round(ms / DAY_MS) + 'd'
  return (ms / (30 * DAY_MS)).toFixed(1).replace(/\.0$/, '') + 'mo'
}
