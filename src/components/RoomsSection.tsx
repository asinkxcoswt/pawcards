import { useState } from 'react'
import { useStore } from '../store'
import { syncConfigured } from '../lib/sync'
import { expiresLabel, newMemberId, newRoomCode, roomExpired } from '../lib/room'
import { inviteConfig, inviteGrantsServer, parseInvite, type InvitePayload } from '../lib/invite'
import { newSyncId } from '../lib/settings'
import { now } from '../lib/constants'
import QrScanner from './QrScanner'
import Icon from './Icon'

/**
 * Home-screen section: joined rooms + create/join entry points.
 * Create/join only store a RoomRef — the room itself comes alive when
 * RoomView opens its WebSocket (the first connector names the room).
 */
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
          <span className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-muted">
            <Icon name="room" size={15} /> Rooms
          </span>
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
            <Icon name="plus" size={15} /> Create
          </button>
          <button className="btn px-2.5 py-1 text-[13px]" data-testid="room-join" onClick={() => setJoining(true)}>
            <Icon name="camera" size={15} /> Join
          </button>
        </div>
        {rooms.some((r) => !roomExpired(r)) && (
          <div className="flex flex-wrap gap-2">
            {rooms
              .filter((r) => !roomExpired(r)) // expired rooms hide (re-scan a renewed invite to bring one back)
              .map((r) => (
                <button key={r.code} className="btn" data-testid={'room-chip-' + r.code} onClick={() => openRoom(r.code)}>
                  <Icon name="room" size={15} /> {r.name}
                  {r.expiresAt ? <span className="text-xs text-muted">⏳ {expiresLabel(r.expiresAt)}</span> : null}
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
  const [expDays, setExpDays] = useState('')
  const [shareServer, setShareServer] = useState(false)

  const create = () => {
    const roomName = name.trim()
    const by = nickname.trim()
    if (!roomName || !by) return
    const days = parseInt(expDays, 10)
    if (expDays.trim() && (!Number.isFinite(days) || days < 1 || days > 365)) {
      showToast('Expiry must be 1–365 days (or leave it empty)')
      return
    }
    saveSettings({ nickname: by })
    const code = newRoomCode()
    addRoomRef({
      code,
      url: settings.syncUrl,
      name: roomName,
      by,
      ...(shareServer ? { shareServer: true } : {}),
      ...(expDays.trim() ? { expiresAt: now() + days * 24 * 60 * 60 * 1000 } : {}),
      memberId: newMemberId(),
      joinedAt: now(),
    })
    onClose()
    openRoom(code)
    showToast(`🏫 Room “${roomName}” created — invite friends from inside`)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
          <Icon name="room" size={17} /> Create a room
        </h2>
        <p className="hint mb-3.5">
          The room lives on your Worker for 60 days after the last activity. Friends join by scanning the invite QR.
        </p>
        <label className="field-label">Room name</label>
        <input className="field-input mb-3" autoFocus placeholder="e.g. Thai Cooking Workshop" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} data-testid="room-name" />
        <label className="field-label">Your name (shown to the group)</label>
        <input className="field-input mb-3" placeholder="your nickname" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} data-testid="room-nickname" />
        <label className="field-label">Room expires after (days, optional)</label>
        <input
          className="field-input"
          type="number"
          inputMode="numeric"
          min={1}
          max={365}
          placeholder="empty = 60 days after last activity"
          value={expDays}
          onChange={(e) => setExpDays(e.target.value)}
          data-testid="room-exp-days"
        />

        <div className="mt-3.5 rounded-xl border border-line bg-paper p-3">
          <button
            type="button"
            role="switch"
            aria-checked={shareServer}
            data-testid="room-share-server"
            onClick={() => setShareServer((v) => !v)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span className="flex-1 text-[13px] font-semibold">Let guests make AI images on my account</span>
            <span className={'relative h-6 w-10 shrink-0 rounded-full transition-colors ' + (shareServer ? 'bg-accent' : 'bg-line')}>
              <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (shareServer ? 'left-[18px]' : 'left-0.5')} />
            </span>
          </button>
          <p className="mt-2 text-[12.5px] leading-snug text-muted">
            {shareServer
              ? 'On: guests can also make AI images through your account. This uses your account’s daily limits, so keep it to people you trust.'
              : 'Off: guests can join and review the decks you share, but bring their own setup — they can’t make AI images through your account.'}
          </p>
        </div>

        <div className="mt-3.5 flex gap-2.5">
          <button className="btn btn-primary" disabled={!name.trim() || !nickname.trim()} data-testid="room-create-go" onClick={create}>
            <Icon name="room" size={16} /> Create room
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
  const [qr, setQr] = useState<InvitePayload | null>(null)
  const [nickname, setNickname] = useState(settings.nickname)
  const [error, setError] = useState('')

  const onCode = (text: string) => {
    try {
      const p = parseInvite(text)
      if (!p.code) throw new Error('This invite has no room in it — scan it in Settings to import the server config')
      if (p.exp && p.exp < now()) throw new Error('This invite has expired — ask the host for a fresh one')
      setQr(p)
      setError('')
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  const join = () => {
    if (!qr?.code) return
    const by = nickname.trim()
    if (!by) return
    saveSettings({ nickname: by })
    // a fresh app adopts the room's server as its main settings ONLY when the
    // invite grants server use (full key). A room-only invite (pr_) just joins.
    const s = useStore.getState().settings
    if (!s.syncUrl.trim() && !s.apiKey.trim() && inviteGrantsServer(qr.url)) {
      saveSettings({ ...inviteConfig(qr), syncId: s.syncId.trim() || newSyncId(), onboarded: true })
      showToast('☁ Set up with the room’s server — welcome! 🐾')
    }
    const existing = useStore.getState().rooms.find((r) => r.code === qr.code)
    addRoomRef({
      code: qr.code,
      url: qr.url,
      name: qr.name ?? 'Room',
      ...(qr.by ? { by: qr.by } : {}),
      ...(qr.exp ? { expiresAt: qr.exp } : {}),
      memberId: existing?.memberId ?? newMemberId(),
      joinedAt: existing?.joinedAt ?? now(),
    })
    onClose()
    openRoom(qr.code)
    showToast(`🏫 Joined “${qr.name ?? 'Room'}”`)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[85dvh] w-full max-w-[560px] overflow-y-auto rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        {!qr && (
          <>
            <h2 className="m-0 mb-1 flex items-center gap-1.5 text-[17px] font-bold">
              <Icon name="camera" size={17} /> Join a room
            </h2>
            <p className="hint mb-3.5">
              Scan the room's invite QR (the host taps “Invite” inside the room) — or pick a saved QR image.
            </p>
            <QrScanner active={!qr} onCode={onCode} />
          </>
        )}
        {qr && (
          <>
            <h2 className="m-0 mb-1 text-[17px] font-bold">Join “{qr.name ?? 'Room'}”?</h2>
            {qr.exp ? <p className="hint mb-2">⏳ {expiresLabel(qr.exp)} · until {new Date(qr.exp).toLocaleDateString()}</p> : null}
            <label className="field-label">Your name (shown to the group)</label>
            <input className="field-input" autoFocus placeholder="your nickname" value={nickname} maxLength={24} onChange={(e) => setNickname(e.target.value)} data-testid="join-nickname" />
            <div className="mt-3.5 flex gap-2.5">
              <button className="btn btn-primary" disabled={!nickname.trim()} data-testid="join-go" onClick={join}>
                <Icon name="room" size={16} /> Join room
              </button>
              <button className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
        {error && <p className="hint mt-3 text-again">{error}</p>}
        {!qr && (
          <button className="btn btn-ghost mt-4" onClick={onClose}>
            Close
          </button>
        )}
      </div>
    </div>
  )
}
