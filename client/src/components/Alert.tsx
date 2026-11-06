import type { ReactNode } from 'react'

export type AlertTone = 'info' | 'success' | 'error'

const tones: Record<AlertTone, string> = {
  info: 'border-zinc-200 bg-white text-zinc-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
}

/** Inline feedback. Errors are announced assertively, other tones politely. */
export function Alert({ tone, title, children, actions }: { tone: AlertTone; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex flex-col gap-3 rounded-md border px-4 py-3 text-sm sm:flex-row sm:items-start sm:justify-between ${tones[tone]}`}>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 break-words opacity-90">{children}</div>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}
