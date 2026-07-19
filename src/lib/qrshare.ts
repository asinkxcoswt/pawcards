/**
 * Share or save a QR canvas as a PNG. On devices with the Web Share API +
 * file support (phones), opens the native share sheet (Line, AirDrop, save to
 * Photos…). Elsewhere (desktop) it downloads the image.
 */
export type QrShareResult = 'shared' | 'downloaded' | 'cancelled'

function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /data:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

export async function shareOrDownloadCanvas(
  canvas: HTMLCanvasElement,
  filename: string,
  title: string,
): Promise<QrShareResult> {
  // build the file synchronously so the user gesture stays valid for share()
  const dataUrl = canvas.toDataURL('image/png')
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
  try {
    const file = new File([dataUrlToBlob(dataUrl)], filename, { type: 'image/png' })
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title })
      return 'shared'
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return 'cancelled' // user closed the sheet
    // any other share failure → fall through to download
  }
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
  return 'downloaded'
}
