import QRCode from 'qrcode'
import { encodeConfig } from '../src/lib/qrconfig'
import { defaultSettings } from '../src/lib/settings'

/**
 * Settings QR generated after a deploy that minted a new key. Encodes the
 * SAME `pawcards-config` payload the in-app Settings QR uses, so
 * PawCards → Settings → 📷 Scan settings QR imports it directly.
 * syncId is left blank: each scanning device keeps its own Sync ID.
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
}

/** A self-contained SVG card styled like the app's settings-QR sheet. */
export async function settingsQrSvg(info: QrCardInfo): Promise<string> {
  const qr = await QRCode.toString(stackConfigPayload(info.endpoint), {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
  })
  // nest the generated QR svg at a fixed position/size inside our card
  const qrNested = qr.replace('<svg ', '<svg x="80" y="96" width="300" height="300" ')
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const font = `-apple-system, 'Segoe UI', 'Helvetica Neue', sans-serif`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="500" viewBox="0 0 460 500">
  <rect width="460" height="500" fill="#f6f4ef"/>
  <rect x="10" y="10" width="440" height="480" rx="20" fill="#ffffff" stroke="#e6e2d8"/>
  <text x="30" y="52" font-family="${font}" font-size="19" font-weight="700" fill="#22211f">🐾 PawCards settings</text>
  <text x="30" y="76" font-family="${font}" font-size="13" fill="#8a867d">${esc(info.worker)} · ${esc(info.host)}</text>
  ${qrNested}
  <text x="30" y="428" font-family="${font}" font-size="13" fill="#8a867d">Generated ${esc(info.date)} · ${esc(info.note)}</text>
  <text x="30" y="450" font-family="${font}" font-size="13" fill="#22211f">Scan: PawCards → Settings → 📷 Scan settings QR</text>
  <text x="30" y="472" font-family="${font}" font-size="11" fill="#c04b3a">Contains the access key — keep it within your group.</text>
</svg>
`
}
