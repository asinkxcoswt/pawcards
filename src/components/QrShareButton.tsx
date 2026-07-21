import type { RefObject } from 'react'
import { useStore } from '../store'
import { shareOrDownloadCanvas } from '../lib/qrshare'
import Icon from './Icon'

/** "Share / Save" button under a QR canvas — native share on mobile, download on desktop. */
export default function QrShareButton({
  canvasRef,
  filename,
  title,
  className = 'mt-3',
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  filename: string
  title: string
  /** margin/layout classes — pass '' when placed inside a flex button row */
  className?: string
}) {
  const showToast = useStore((s) => s.showToast)
  return (
    <button
      className={'btn ' + className}
      data-testid="qr-share-btn"
      onClick={() => {
        const cv = canvasRef.current
        if (!cv) return
        void shareOrDownloadCanvas(cv, filename, title).then((r) => {
          if (r === 'downloaded') showToast('QR image saved 📥')
        })
      }}
    >
<Icon name="upload" size={16} /> Share / Save image
    </button>
  )
}
