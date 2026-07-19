import { useStore } from '../store'
import { syncConfigured } from '../lib/sync'

/**
 * Floating "you have unsynced edits" button — replaces the old 30s auto-sync.
 * Hidden on the editor/review screens so it never covers the canvas or cards.
 */
export default function SyncFab() {
  const dirty = useStore((s) => s.dirty)
  const syncing = useStore((s) => s.syncing)
  const settings = useStore((s) => s.settings)
  const screen = useStore((s) => s.screen)

  if (screen === 'editor' || screen === 'review') return null
  if (!syncConfigured(settings) || (!dirty && !syncing)) return null

  return (
    <button
      className="btn btn-primary fixed left-1/2 z-30 -translate-x-1/2 rounded-full px-5"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      disabled={syncing}
      data-testid="sync-fab"
      onClick={() => void useStore.getState().syncNow(false)}
    >
      {syncing ? '⏳ Syncing…' : '☁ Sync changes'}
    </button>
  )
}
