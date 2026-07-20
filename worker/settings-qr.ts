import QRCode from 'qrcode'
import { encodeInvite, type InvitePayload } from '../src/lib/invite'
import { encodeConfig } from '../src/lib/qrconfig'
import { defaultSettings } from '../src/lib/settings'

/**
 * QR card generated after a deploy that minted a new key.
 *
 * Without a room: encodes the SAME `pawcards-config` payload the in-app
 * Settings QR uses (PawCards → Settings → 📷 Scan settings QR imports it;
 * syncId left blank so each device keeps its own).
 *
 * With a room (deploy --room): encodes the invite payload instead — fresh
 * apps onboard fully from it, configured apps just join the room.
 */
export function stackConfigPayload(endpoint: string): string {
  return encodeConfig({
    provider: 'local',
    apiKey: '',
    apiUrl: endpoint,
    model: '',
    prompt: defaultSettings().prompt,
    syncUrl: endpoint,
    syncId: '',
  })
}

export interface QrCardInfo {
  /** full endpoint incl ?key= — goes into the QR payload */
  endpoint: string
  /** worker/stack name, shown to humans */
  worker: string
  /** host shown to humans (no key!) */
  host: string
  /** e.g. "new stack" | "key rotated" */
  note: string
  date: string
  /** when set, the QR carries this invite (room join + onboarding) instead of plain settings */
  invite?: InvitePayload
}

/** A self-contained SVG card styled like the app's settings-QR sheet. */
export async function settingsQrSvg(info: QrCardInfo): Promise<string> {
  const payload = info.invite ? encodeInvite(info.invite) : stackConfigPayload(info.endpoint)
  const qr = await QRCode.toString(payload, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
  })
  // nest the generated QR svg at a fixed position/size inside our card
  const qrNested = qr.replace('<svg ', '<svg x="80" y="96" width="300" height="300" ')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const font = `-apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif`
  const title = info.invite?.name ? `🐾 ${esc(info.invite.name)}` : '🐾 PawCards settings'
  const exp = info.invite?.exp ? ` · expires ${new Date(info.invite.exp).toISOString().slice(0, 10)}` : ''
  const scanHint = info.invite
    ? 'Scan: PawCards → Rooms → 📷 Join (new users: any QR scanner)'
    : 'Scan: PawCards → Settings → 📷 Scan settings QR'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="500" viewBox="0 0 460 500">
  <rect width="460" height="500" fill="#f6f4ef"/>
  <rect x="10" y="10" width="440" height="480" rx="20" fill="#ffffff" stroke="#e6e2d8"/>
  <text x="30" y="52" font-family="${font}" font-size="19" font-weight="700" fill="#22211f">${title}</text>
  <text x="30" y="76" font-family="${font}" font-size="13" fill="#8a867d">${esc(info.worker)} · ${esc(info.host)}${esc(exp)}</text>
  ${qrNested}
  <text x="30" y="428" font-family="${font}" font-size="13" fill="#8a867d">Generated ${esc(info.date)} · ${esc(info.note)}</text>
  <text x="30" y="450" font-family="${font}" font-size="13" fill="#22211f">${scanHint}</text>
  <text x="30" y="472" font-family="${font}" font-size="11" fill="#c04b3a">Contains the access key — keep it within your group.</text>
</svg>
`
}
