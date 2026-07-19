import { useRef, useState } from 'react'
import { useStore } from '../store'

/**
 * The app's "tap again to confirm" pattern for destructive actions —
 * kinder than a blocking dialog, still guards against slips.
 */
export default function ConfirmButton({
  label,
  armedLabel = '❗',
  className,
  title,
  toastMsg = 'Tap again to confirm',
  onConfirm,
}: {
  label: string
  armedLabel?: string
  className?: string
  title?: string
  toastMsg?: string
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showToast = useStore((s) => s.showToast)

  const click = () => {
    if (armed) {
      clearTimeout(timer.current)
      setArmed(false)
      onConfirm()
      return
    }
    setArmed(true)
    showToast(toastMsg)
    timer.current = setTimeout(() => setArmed(false), 2500)
  }

  return (
    <button className={className} title={title} onClick={click}>
      {armed ? armedLabel : label}
    </button>
  )
}
