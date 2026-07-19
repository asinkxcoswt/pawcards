import { describe, expect, it } from 'bun:test'
import { DAY_MS, MIN_MS } from '../src/lib/constants'
import { applyGrade, dueCards, fmtIv, isDue, newSrs, previewIntervals, unretire } from '../src/lib/srs'
import type { Card } from '../src/lib/types'

const mkCard = (over: Partial<Card> = {}): Card => ({
  id: 'c1',
  deckId: 'd1',
  created: 1000,
  front: [],
  back: [],
  backText: 'x',
  srs: null,
  polished: {},
  ...over,
})

describe('SM-2 grading', () => {
  it('new cards are due immediately', () => {
    expect(isDue(mkCard())).toBe(true)
  })

  it('Good on a new card schedules 1 day', () => {
    const c = mkCard()
    applyGrade(c, 2, 0)
    expect(c.srs!.interval).toBe(DAY_MS)
    expect(c.srs!.due).toBe(DAY_MS)
    expect(c.srs!.reps).toBe(1)
  })

  it('second Good schedules 3 days, then ease multiplies', () => {
    const c = mkCard()
    applyGrade(c, 2, 0)
    applyGrade(c, 2, 0)
    expect(c.srs!.interval).toBe(3 * DAY_MS)
    applyGrade(c, 2, 0)
    expect(c.srs!.interval).toBe(3 * DAY_MS * 2.5)
  })

  it('Again resets reps, counts a lapse, lowers ease, requeues in 10m', () => {
    const c = mkCard()
    applyGrade(c, 2, 0)
    applyGrade(c, 0, 0)
    expect(c.srs!.reps).toBe(0)
    expect(c.srs!.lapses).toBe(1)
    expect(c.srs!.ease).toBeCloseTo(2.3)
    expect(c.srs!.due).toBe(10 * MIN_MS)
  })

  it('ease never drops below 1.3', () => {
    const c = mkCard()
    for (let i = 0; i < 20; i++) applyGrade(c, 0, 0)
    expect(c.srs!.ease).toBeCloseTo(1.3)
  })

  it('Easy retires the card — never due again', () => {
    const c = mkCard()
    applyGrade(c, 3, 0)
    expect(c.srs!.retired).toBe(true)
    expect(isDue(c, Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it('unretire (shuffle rescue) brings a retired card back as due', () => {
    const c = mkCard()
    applyGrade(c, 3, 0)
    unretire(c, 5)
    expect(c.srs!.retired).toBe(false)
    expect(isDue(c, 5)).toBe(true)
  })

  it('easy preview shows retirement, not an interval', () => {
    expect(previewIntervals(mkCard()).easy).toBe(0)
  })
})

describe('due queue', () => {
  it('sorts by due date, oldest first, and excludes retired', () => {
    const a = mkCard({ id: 'a', srs: { ...newSrs(0), due: 300 } })
    const b = mkCard({ id: 'b', srs: { ...newSrs(0), due: 100 } })
    const r = mkCard({ id: 'r', srs: { ...newSrs(0), due: 0, retired: true } })
    const fresh = mkCard({ id: 'n' })
    const q = dueCards([a, b, r, fresh], null, 1000)
    expect(q.map((c) => c.id)).toEqual(['n', 'b', 'a'])
  })
})

describe('fmtIv', () => {
  it('formats minutes, hours, days, months', () => {
    expect(fmtIv(10 * MIN_MS)).toBe('10m')
    expect(fmtIv(3 * 60 * MIN_MS)).toBe('3h')
    expect(fmtIv(4 * DAY_MS)).toBe('4d')
    expect(fmtIv(60 * DAY_MS)).toBe('2mo')
  })
})
