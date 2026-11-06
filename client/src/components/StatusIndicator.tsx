export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

const tones: Record<StatusTone, { dot: string; text: string }> = {
  neutral: { dot: 'bg-zinc-400', text: 'text-zinc-600' },
  info: { dot: 'bg-accent-500', text: 'text-accent-700' },
  success: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-700' },
  danger: { dot: 'bg-red-500', text: 'text-red-700' },
}

/** A colored dot plus label. The label always carries the meaning (color is never the only signal). */
export function StatusIndicator({ tone, label, live = false }: { tone: StatusTone; label: string; live?: boolean }) {
  const t = tones[tone]
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-medium ${t.text}`} role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
      <span className={`size-2 shrink-0 rounded-full ${t.dot}`} aria-hidden="true" />
      {label}
    </span>
  )
}
