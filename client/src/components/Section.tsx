import type { ReactNode } from 'react'

/** A titled content block with consistent spacing. */
export function Section({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      {(title || description) && (
        <div className="mb-3">
          {title && <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>}
          {description && <p className="mt-1 text-sm text-zinc-600">{description}</p>}
        </div>
      )}
      {children}
    </section>
  )
}
