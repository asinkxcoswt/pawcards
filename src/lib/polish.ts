import { describePrompt, instructPrompt } from './prompts'
import type { Settings } from './types'

/**
 * AI image generation ("polish"). Since v1.8 this is text-to-image ONLY:
 * ✨ creates the front image from the card's answer text; the user draws
 * on top. (img2img sketch-polishing was tried and removed — SD1.5-class
 * img2img quality wasn't worth it.)
 *
 * Providers:
 * - local: PawCards Cloudflare Worker (Flux + Thai translation) or any
 *   A1111-compatible server. JSON in, { images: [b64] } out.
 * - gemini: Google generateContent (Nano Banana understands Thai natively).
 * - openai: images/generations.
 */

async function blobless(u: string): Promise<string> {
  const b = await (await fetch(u)).blob()
  return new Promise((res) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.readAsDataURL(b)
  })
}

export async function polishLocal(s: Settings, subject: string): Promise<string> {
  const payload = JSON.stringify({
    prompt: describePrompt(s, subject),
    negative_prompt: 'blurry, messy, low quality',
    width: 1024,
    height: 640,
  })
  const doFetch = (url: string) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
  // A1111-style servers use a separate txt2img route; the PawCards worker
  // handles both modes on one URL, so the replace is a harmless no-op there.
  const endpoint = s.apiUrl.replace('img2img', 'txt2img')
  let rsp: Response
  try {
    rsp = await doFetch(endpoint)
  } catch {
    // direct call blocked (CORS/mixed content)? try same-origin proxy path
    if (/^https?:/.test(location.origin)) {
      try {
        rsp = await doFetch(location.origin + '/sdapi/v1/txt2img')
      } catch {
        throw new Error('cannot reach the image server — is it running? (see setup notes)')
      }
    } else {
      throw new Error('cannot reach the image server — is it running? (see setup notes)')
    }
  }
  if (!rsp.ok) {
    const txt = await rsp.text().catch(() => '')
    throw new Error('local API ' + rsp.status + ' ' + txt.slice(0, 120))
  }
  const data = await rsp.json()
  const img: string | undefined = data.images?.[0]
  if (!img) throw new Error('no image in response')
  return img.startsWith('data:') ? img : 'data:image/png;base64,' + img
}

export async function polishGemini(s: Settings, subject: string): Promise<string> {
  const endpoint =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(s.model) +
    ':generateContent'
  const rsp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: instructPrompt(s, subject) }] }] }),
  })
  const data = await rsp.json().catch(() => null)
  if (!rsp.ok) {
    const msg = data?.error?.message
    throw new Error('Gemini ' + rsp.status + (msg ? ': ' + msg.slice(0, 140) : ''))
  }
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    const d = p.inlineData?.data ?? p.inline_data?.data
    if (d) {
      const mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? 'image/png'
      return 'data:' + mime + ';base64,' + d
    }
  }
  const txt = parts.find((p) => p.text)
  throw new Error(txt ? 'model replied with text: ' + txt.text.slice(0, 120) : 'no image in response')
}

export async function polishOpenAI(s: Settings, subject: string): Promise<string> {
  const rsp = await fetch(s.apiUrl.replace('/edits', '/generations'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + s.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.model, prompt: instructPrompt(s, subject) }),
  })
  if (!rsp.ok) {
    const txt = await rsp.text().catch(() => '')
    throw new Error('API ' + rsp.status + ' ' + txt.slice(0, 140))
  }
  const data = await rsp.json()
  const item = data.data?.[0]
  if (item?.b64_json) return 'data:image/png;base64,' + item.b64_json
  if (item?.url) return blobless(item.url)
  throw new Error('no image in response')
}

export function runPolish(s: Settings, subject: string): Promise<string> {
  if (s.provider === 'gemini') return polishGemini(s, subject)
  if (s.provider === 'local') return polishLocal(s, subject)
  return polishOpenAI(s, subject)
}
