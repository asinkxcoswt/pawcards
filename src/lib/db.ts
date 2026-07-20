import type { Doc } from './types'

/**
 * Persistence: the whole Doc is stored as one value in IndexedDB
 * (db "pawcards", store "doc", key "state") — same location the
 * single-file versions used, so existing data carries over on the
 * same origin.
 */

let dbPromise: Promise<IDBDatabase | null> | null = null
export let memoryOnly = false

function openDB(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const rq = indexedDB.open('pawcards', 2)
        rq.onupgradeneeded = () => {
          const db = rq.result
          if (!db.objectStoreNames.contains('doc')) db.createObjectStore('doc')
          // v2: card image blobs, keyed by img id — the sync doc holds only refs
          if (!db.objectStoreNames.contains('images')) db.createObjectStore('images')
        }
        rq.onsuccess = () => resolve(rq.result)
        rq.onerror = () => {
          memoryOnly = true
          resolve(null)
        }
      } catch {
        memoryOnly = true
        resolve(null)
      }
    })
  }
  return dbPromise
}

export async function loadDoc(): Promise<Doc | null> {
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve) => {
    const tx = db.transaction('doc', 'readonly').objectStore('doc').get('state')
    tx.onsuccess = () => resolve((tx.result as Doc) ?? null)
    tx.onerror = () => resolve(null)
  })
}

export async function saveDoc(doc: Doc): Promise<void> {
  const db = await openDB()
  if (!db) return
  try {
    db.transaction('doc', 'readwrite').objectStore('doc').put(doc, 'state')
  } catch (e) {
    console.error('save failed', e)
  }
}

/* ---------- image blob cache (v2 'images' store, keyed by img id) ---------- */

export async function imgCacheGet(id: string): Promise<Blob | null> {
  const db = await openDB()
  if (!db || !db.objectStoreNames.contains('images')) return null
  return new Promise((resolve) => {
    const tx = db.transaction('images', 'readonly').objectStore('images').get(id)
    tx.onsuccess = () => resolve((tx.result as Blob) ?? null)
    tx.onerror = () => resolve(null)
  })
}

export async function imgCachePut(id: string, blob: Blob): Promise<void> {
  const db = await openDB()
  if (!db || !db.objectStoreNames.contains('images')) return
  try {
    db.transaction('images', 'readwrite').objectStore('images').put(blob, id)
  } catch (e) {
    console.error('image cache save failed', e)
  }
}

/* ---------- one-shot flags (e.g. "example deck already seeded") ---------- */

const SEEDED_KEY = 'flag:exampleSeeded'

/** true once the example deck has been seeded on this device (survives reloads) */
export async function getExampleSeeded(): Promise<boolean> {
  const db = await openDB()
  if (!db) return false
  return new Promise((resolve) => {
    const tx = db.transaction('doc', 'readonly').objectStore('doc').get(SEEDED_KEY)
    tx.onsuccess = () => resolve(tx.result === true)
    tx.onerror = () => resolve(false)
  })
}

/** set (true) or clear (false — makes this device "new" again) the seeded flag */
export async function setExampleSeeded(value: boolean): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    const store = db.transaction('doc', 'readwrite').objectStore('doc')
    const rq = value ? store.put(true, SEEDED_KEY) : store.delete(SEEDED_KEY)
    rq.onsuccess = () => resolve()
    rq.onerror = () => resolve()
  })
}

/** drop cached blobs whose ids are not in `keep` (mirrors the server-side GC) */
export async function imgCachePrune(keep: Set<string>): Promise<void> {
  const db = await openDB()
  if (!db || !db.objectStoreNames.contains('images')) return
  await new Promise<void>((resolve) => {
    const store = db.transaction('images', 'readwrite').objectStore('images')
    const rq = store.getAllKeys()
    rq.onsuccess = () => {
      for (const k of rq.result) if (typeof k === 'string' && !keep.has(k)) store.delete(k)
      resolve()
    }
    rq.onerror = () => resolve()
  })
}
