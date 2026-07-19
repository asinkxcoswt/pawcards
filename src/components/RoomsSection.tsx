import { useState } from 'react'
import { useStore } from '../store'
import { syncConfigured } from '../lib/sync'
import { useQrScan } from '../lib/useQrScan'
import { createRoom, joinRoom, parseRoomQr, type RoomQr } from '../lib/room'
import { now } from '../lib/constants'

const chunk = () => Math.random().toString(36).slice(2, 6)

/** Home-screen section: joined rooms + create/join entry points. */
export default function RoomsSection() {
  const rooms = useStore((s) => s.rooms)
  const settings = useStore((s) => s.settings)
  const { openRoom, showToast } = useStore.getState()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

  return (
    <>
      <div className="mb-4.5">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-[13px] font-bold uppercase tracking-wide text-muted">🏫 Rooms</span>
          <div className="flex-1" />
          <button
            className="btn px-2.5 py-1 text-[13px]"
            data-testid="room-create"
            onClick={() => {
              if (!syncConfigured(settings)) {
                showToast('Set up your Worker in Settings → Cloud sync first')
                return
              }
              setCreating(true)
            }}
          >
            ＋ Create
          </button>
          <button className="btn px-2.5 py-1 text-[13px]" data-testid="room-join" onClick={() => setJoining(true)}>
            📷 Join
          </button>
        </div>
        {rooms.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rooms.map((r) => (
              <button key={r.code} className="btn" data-testid={'room-chip-' + r.code} onClick={() => openRoom(r.code)}>
                🏫 {r.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {creating && <CreateRoomModal onClose={() => setCreating(false)} />}
      {joining && <JoinRoomModal onClose={() => setJoining(false)} />}
    </>
  )
}

function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const { addRoomRef, openRoom, saveSettings, showToast } = useStore.getState()
  const [name, setName] = useState('')
  const [nickname, setNickname] = useState(settings.nickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    const roomName = name.trim()
    const by = nickname.trim()
    if (!roomName || !by) return
    setBusy(true)
    setError('')
    try {
      saveSettings({ nickname: by })
      const code = await createRoom(settings.syncUrl, roomName, by)
      const memberId = chunk() + chunk()
      await joinRoom(settings.syncUrl, code, memberId, by)
      addRoomRef({ code, url: settings.syncUrl, name: roomName, memberId, joinedAt: now() })
      onClose()
      openRoom(code)
      showToast(`🏫 Room “${roomName}” created — invite friends from inside`)
    } catch (e) {
      setError('Could not create the room: ' + (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 text-[17px] font-bold">🏫 Create a room</h2>
        <p className="hint mb-3.5">
          A room lives on your Worker for 60 days. Friends join by scanning the invite QR and can share decks into it.
        </p>
        <label className="field-label">Room name</label>
        <input className="field-input mb-3" autoFocus placeholder="e.g. Thai Cooking Workshop" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} data-testid="room-name" />
        <label className="field-label">Your name (shown to the group)</label>
        <input className="field-input" placeholder="your nickname" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} data-testid="room-nickname" />
        {error && <p className="hint mt-3 text-again">{error}</p>}
        <div className="mt-3.5 flex gap-2.5">
          <button className="btn btn-primary" disabled={busy || !name.trim() || !nickname.trim()} data-testid="room-create-go" onClick={() => void create()}>
            {busy ? '⏳ Creating…' : '🏫 Create room'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function JoinRoomModal({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const { addRoomRef, openRoom, saveSettings, showToast } = useStore.getState()
  const [qr, setQr] = useState<RoomQr | null>(null)
  const [nickname, setNickname] = useState(settings.nickname)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const { videoRef, error: camError } = useQrScan(!qr, (text) => {
    try {
      setQr(parseRoomQr(text))
      setError('')
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  })

  const join = async () => {
    if (!qr) return
    const by = nickname.trim()
    if (!by) return
    setBusy(true)
    setError('')
    try {
      saveSettings({ nickname: by })
      const existing = useStore.getState().rooms.find((r) => r.code === qr.code)
      const memberId = existing?.memberId ?? chunk() + chunk()
      await joinRoom(qr.url, qr.code, memberId, by)
      addRoomRef({ code: qr.code, url: qr.url, name: qr.name, memberId, joinedAt: existing?.joinedAt ?? now() })
      onClose()
      openRoom(qr.code)
      showToast(`🏫 Joined “${qr.name}”`)
    } catch (e) {
      setError('Could not join: ' + (e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        {!qr && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">📷 Join a room</h2>
            <p className="hint mb-3.5">Scan the room's invite QR (the host taps “Invite” inside the room).</p>
            <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" />
          </>
        )}
        {qr && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">Join “{qr.name}”?</h2>
            <label className="field-label">Your name (shown to the group)</label>
            <input className="field-input" autoFocus placeholder="your nickname" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} data-testid="join-nickname" />
            <div className="mt-3.5 flex gap-2.5">
              <button className="btn btn-primary" disabled={busy || !nickname.trim()} data-testid="join-go" onClick={() => void join()}>
                {busy ? '⏳ Joining…' : '🏫 Join room'}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
        {(error || camError) && <p className="hint mt-3 text-again">{error || camError}</p>}
        {!qr && (
          <button className="btn btn-ghost mt-4" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  )
}
