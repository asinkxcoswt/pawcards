import { useCallback, useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

/**
 * QR input for scanners: live camera decode loop + decoding a picked image
 * file (photo/screenshot/SVG card). Attach `videoRef` to a <video>; `onCode`
 * is called for every decoded QR — return true to stop the camera, false to
 * keep looking (e.g. wrong QR type).
 */
export function useQrScan(active: boolean, onCode: (text: string) => boolean) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  /** decode a user-picked image (gallery photo, screenshot, or the deploy-script SVG card) */
  const scanFile = useCallback(async (file: File) => {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image()
      img.src = url
      await img.decode()
      const decodeAt = (max: number) => {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        const d = ctx.getImageData(0, 0, w, h)
        return jsQR(d.data, w, h)
      }
      // photos of screens often decode better downscaled — try two sizes
      const code = decodeAt(1600) ?? decodeAt(800)
      if (code?.data) {
        setError('')
        onCodeRef.current(code.data)
      } else {
        setError('No QR code found in that image — try a sharper, closer shot')
      }
    } catch {
      setError('Could not read that image')
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [])

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
        setError('Camera unavailable — allow camera access, or pick the QR from a photo below.')
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

  return { videoRef, error, scanFile }
}
