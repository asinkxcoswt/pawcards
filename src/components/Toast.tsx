import { useEffect, useState } from 'react'
import { useStore } from '../store'

export default function Toast() {
  const toast = useStore((s) => s.toast)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!toast) return
    setVisible(true)
    const h = setTimeout(() => setVisible(false), 2600)
    return () => clearTimeout(h)
  }, [toast])

  return (
    <div
      id="toast"
      className={
        'fixed left-1/2 z-50 max-w-[88vw] rounded-full bg-ink px-4.5 py-2.5 text-center text-[13px] font-semibold text-white shadow-soft transition-all duration-250 ' +
        (visible ? '-translate-x-1/2 translate-y-0 opacity-100' : '-translate-x-1/2 translate-y-[200px] opacity-0 pointer-events-none')
      }
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
    >
      {toast?.msg}
    </div>
  )
}
