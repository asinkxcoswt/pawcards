import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { inviteConfig, type InvitePayload } from '../lib/invite'
import { expiresLabel, newMemberId } from '../lib/room'
import { newSyncId } from '../lib/settings'
import { now } from '../lib/constants'
import Icon from './Icon'
import Logo from './Logo'

/**
 * Handles a ready-to-share invite link (#ws= fragment) after boot:
 *
 * - fresh app (no server settings): main settings initialize from the
 *   invite's worker URL — a new Sync ID is minted, onboarding is skipped
 * - the invite's room is added right away (its pill appears on Home) and a
 *   "X invites you" popup offers Join now / Skip
 * - configured apps keep their main settings — the room joins as a bridge
 *   with its own url/key (RoomRef), nothing else changes
 *
 * The fragment is deliberately KEPT in the address bar: on iOS,
 * Add-to-Home-Screen uses the current URL, so the installed PWA relaunches
 * with the invite and this same code re-applies it into the PWA's own
 * (separate) storage. Everything here is idempotent, so relaunches are safe.
 */
export default function InviteGate({ invite }: { invite: InvitePayload }) {
  const settings = useStore((s) => s.settings)
  const { saveSettings, addRoomRef, openRoom, showToast } = useStore.getState()
  const [popup, setPopup] = useState<'invite' | 'expired' | null>(null)
  const [nickname, setNickname] = useState(settings.nickname)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    if (invite.exp && invite.exp < now()) {
      setPopup('expired')
      return
    }
    const s = useStore.getState().settings
    const fresh = !s.syncUrl.trim() && !s.apiKey.trim()
    if (fresh) {
      saveSettings({
        ...inviteConfig(invite),
        syncId: s.syncId.trim() || newSyncId(),
        onboarded: true,
      })
      showToast('☁ Set up and ready — welcome! 🐾')
    }
    if (invite.code) {
      const known = useStore.getState().rooms.some((r) => r.code === invite.code)
      if (!known) {
        addRoomRef({
          code: invite.code,
          url: invite.url,
          name: invite.name ?? 'Room',
          ...(invite.by ? { by: invite.by } : {}),
          ...(invite.exp ? { expiresAt: invite.exp } : {}),
          memberId: newMemberId(),
          joinedAt: now(),
        })
        setPopup('invite') // already-joined relaunches stay quiet
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!popup) return null

  if (popup === 'expired') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,25,18,.5)] p-4">
        <div className="w-full max-w-[420px] rounded-[20px] bg-panel p-5 shadow-soft" data-testid="invite-expired">
          <div className="mb-2 flex justify-center">
            <Logo className="h-9" />
          </div>
          <h2 className="m-0 mb-1 text-center text-[19px] font-bold">This invite has expired</h2>
          <p className="hint mb-4 text-center">
            {invite.by ? `Ask ${invite.by}` : 'Ask the person who sent it'} for a fresh invite link.
          </p>
          <button className="btn btn-ghost w-full justify-center" data-testid="invite-expired-close" onClick={() => setPopup(null)}>
            Close
          </button>
        </div>
      </div>
    )
  }

  const join = () => {
    const by = nickname.trim()
    if (by) saveSettings({ nickname: by })
    setPopup(null)
    openRoom(invite.code!)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(30,25,18,.5)] p-4">
      <div className="w-full max-w-[420px] rounded-[20px] bg-panel p-5 shadow-soft" data-testid="invite-popup">
        <div className="mb-2 flex justify-center">
          <Logo className="h-9" />
        </div>
        <h2 className="m-0 mb-1 text-center text-[19px] font-bold">
          {invite.by ? `${invite.by} invites you` : 'You are invited'} to “{invite.name ?? 'a room'}”
        </h2>
        <p className="hint mb-3 text-center">
          The room is on your Home screen whenever you're ready.
          {invite.exp ? ` ⏳ ${expiresLabel(invite.exp)}.` : ''}
        </p>
        <label className="field-label">Your name (shown to the group)</label>
        <input
          className="field-input mb-3"
          placeholder="your nickname"
          value={nickname}
          maxLength={24}
          onChange={(e) => setNickname(e.target.value)}
          data-testid="invite-nickname"
        />
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary justify-center" disabled={!nickname.trim()} data-testid="invite-join" onClick={join}>
            <Icon name="room" size={16} /> Join now
          </button>
          <button className="btn btn-ghost" data-testid="invite-skip" onClick={() => setPopup(null)}>
            Skip — stay on Home
          </button>
        </div>
      </div>
    </div>
  )
}
