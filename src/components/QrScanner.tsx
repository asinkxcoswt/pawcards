import { useRef } from 'react'
import { useQrScan } from '../lib/useQrScan'
import Icon from './Icon'

/**
 * The app's one QR input UI: live camera preview + "from a photo" picker
 * (gallery on phones, file dialog on desktop). Used by every scanner —
 * settings transfer, deck import, room join.
 */
export default function QrScanner({ active, onCode }: { active: boolean; onCode: (text: string) => boolean }) {
  const { videoRef, error, scanFile } = useQrScan(active, onCode)
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <video ref={videoRef} playsInline muted className="w-full rounded-lg bg-black" data-testid="qr-video" />
      <div className="mt-2.5 flex gap-2.5">
        <button className="btn" data-testid="qr-from-photo" onClick={() => fileRef.current?.click()}>
          <Icon name="photo" size={16} /> From a photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="qr-file-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void scanFile(f)
          }}
        />
      </div>
      {error && <p className="hint mt-3 text-again">{error}</p>}
    </>
  )
}
