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
        const rq = indexedDB.open('pawcards', 1)
        rq.onupgradeneeded = () => rq.result.createObjectStore('doc')
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
