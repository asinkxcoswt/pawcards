import type { RefObject } from 'react'
import { useStore } from '../store'
import { shareOrDownloadCanvas } from '../lib/qrshare'

/** "Share / Save" button under a QR canvas — native share on mobile, download on desktop. */
export default function QrShareButton({
  canvasRef,
  filename,
  title,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  filename: string
  title: string
}) {
  const showToast = useStore((s) => s.showToast)
  return (
    <button
      className="btn mt-3"
      data-testid="qr-share-btn"
      onClick={() => {
        const cv = canvasRef.current
        if (!cv) return
        void shareOrDownloadCanvas(cv, filename, title).then((r) => {
          if (r === 'downloaded') showToast('QR image saved 📥')
        })
      }}
    >
      ⬆ Share / Save image
    </button>
  )
}
