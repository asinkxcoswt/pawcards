import { describe, expect, it } from 'bun:test'
import {
  IMG_REF_PREFIX,
  imgEndpoint,
  imgGcEndpoint,
  imgIdOf,
  isImgRef,
  pendingUploadCards,
  referencedImgIds,
} from '../src/lib/images'
import type { Card } from '../src/lib/types'

const card = (id: string, front?: string): Card => ({
  id,
  deckId: 'd1',
  created: 1,
  updated: 1,
  front: [],
  back: [],
  backText: '',
  srs: null,
  polished: front ? { front } : {},
})

const conf = { syncUrl: 'https://paw.example.workers.dev/?key=s3cret', syncId: 'paw-aaaa-bbbb-cccc' }

describe('img refs', () => {
  it('recognises refs vs data URLs vs empty', () => {
    expect(isImgRef('img:abc')).toBe(true)
    expect(isImgRef('data:image/png;base64,xxx')).toBe(false)
    expect(isImgRef(undefined)).toBe(false)
    expect(isImgRef('')).toBe(false)
  })

  it('round-trips the id', () => {
    expect(imgIdOf(IMG_REF_PREFIX + 'abc-123')).toBe('abc-123')
  })
})

describe('img endpoints', () => {
  it('builds /img from the sync URL, carrying key + sync id + img id', () => {
    const u = new URL(imgEndpoint(conf, 'im-1'))
    expect(u.origin).toBe('https://paw.example.workers.dev')
    expect(u.pathname).toBe('/img')
    expect(u.searchParams.get('key')).toBe('s3cret')
    expect(u.searchParams.get('id')).toBe('paw-aaaa-bbbb-cccc')
    expect(u.searchParams.get('img')).toBe('im-1')
  })

  it('tolerates a sync URL without ?key=', () => {
    const u = new URL(imgEndpoint({ ...conf, syncUrl: 'https://paw.example.workers.dev' }, 'x'))
    expect(u.searchParams.get('key')).toBe('')
  })

  it('builds the GC endpoint', () => {
    const u = new URL(imgGcEndpoint(conf))
    expect(u.pathname).toBe('/img-gc')
    expect(u.searchParams.get('id')).toBe('paw-aaaa-bbbb-cccc')
  })
})

describe('pendingUploadCards', () => {
  it('picks only cards with inline data URLs', () => {
    const cards = [
      card('a', 'data:image/png;base64,xxx'),
      card('b', 'img:already-uploaded'),
      card('c'),
    ]
    expect(pendingUploadCards(cards).map((c) => c.id)).toEqual(['a'])
  })
})

describe('referencedImgIds (GC keep-list)', () => {
  it('collects ids from refs only — data URLs and empty cards contribute nothing', () => {
    const cards = [
      card('a', 'img:keep-1'),
      card('b', 'data:image/png;base64,xxx'),
      card('c'),
      card('d', 'img:keep-2'),
    ]
    expect([...referencedImgIds(cards)].sort()).toEqual(['keep-1', 'keep-2'])
  })

  it('includes legacy polished.back refs', () => {
    const c = card('a', 'img:f')
    c.polished.back = 'img:b'
    expect([...referencedImgIds([c])].sort()).toEqual(['b', 'f'])
  })
})
