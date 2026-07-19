/**
 * Brand mark — a paw (in the theme accent) + "PawCards" wordmark (ink). Colors
 * come from theme tokens, so it recolors automatically with the active theme.
 * Height is driven by the passed className (e.g. "h-7").
 */
export default function Logo({ className = 'h-7', wordmark = true }: { className?: string; wordmark?: boolean }) {
  return (
    <span className={'inline-flex items-center gap-2 ' + className} aria-label="PawCards">
      <svg viewBox="0 0 32 32" className="h-full w-auto" role="img" aria-hidden="true">
        <ellipse cx="16" cy="21.5" rx="7.5" ry="6" fill="var(--color-accent)" />
        <circle cx="8.5" cy="15" r="2.7" fill="var(--color-accent)" />
        <circle cx="13.5" cy="10.5" r="2.9" fill="var(--color-accent)" />
        <circle cx="18.5" cy="10.5" r="2.9" fill="var(--color-accent)" />
        <circle cx="23.5" cy="15" r="2.7" fill="var(--color-accent)" />
      </svg>
      {wordmark && (
        <span className="text-[19px] font-bold tracking-tight text-ink">
          Paw<span style={{ color: 'var(--color-accent)' }}>Cards</span>
        </span>
      )}
    </span>
  )
}
