import { useEffect, useRef, useState } from 'react'

export default function DeckModal({
  title,
  submitLabel,
  initial = '',
  onSubmit,
  onClose,
}: {
  title: string
  submitLabel: string
  initial?: string
  onSubmit: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const h = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(h)
  }, [])

  const submit = () => {
    const n = name.trim()
    if (!n) {
      inputRef.current?.focus()
      return
    }
    onSubmit(n)
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(30,25,18,.4)]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[560px] rounded-t-[20px] bg-panel p-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}>
        <h2 className="m-0 mb-1 text-[17px] font-bold">{title}</h2>
        <p className="hint mt-0.5 mb-3.5">A deck is one topic you're learning — Spanish, System design, Guitar chords…</p>
        <input
          ref={inputRef}
          className="field-input"
          placeholder="Deck name"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), submit())}
        />
        <div className="mt-4 flex gap-2.5">
          <button className="btn btn-primary" onClick={submit}>
            {submitLabel}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
