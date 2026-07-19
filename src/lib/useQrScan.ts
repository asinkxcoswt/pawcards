import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/**
 * Camera + continuous QR decode loop. Attach `videoRef` to a <video> element;
 * `onCode` is called for every decoded QR — return true to stop scanning
 * (camera released), or false to keep looking (e.g. wrong QR type).
 */
export function useQrScan(active: boolean, onCode: (text: string) => boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (!active) return
    let stream: MediaStream | null = null
    let raf = 0
    let stopped = false
    const det = document.createElement('canvas')
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
      } catch {
        setError('Camera unavailable. Allow camera access and try again.')
        return
      }
      const video = videoRef.current
      if (!video || stopped) return
      video.srcObject = stream
      await video.play().catch(() => {})
      const tick = () => {
        if (stopped) return
        if (video.readyState >= 2 && video.videoWidth) {
          det.width = video.videoWidth
          det.height = video.videoHeight
          const ctx = det.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(video, 0, 0)
          const img = ctx.getImageData(0, 0, det.width, det.height)
          const code = jsQR(img.data, img.width, img.height)
          if (code?.data && onCodeRef.current(code.data)) return // cleanup stops the camera
        }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [active])

  return { videoRef, error }
}
