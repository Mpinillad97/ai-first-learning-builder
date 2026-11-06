import type { ReactNode } from 'react'
import type { SectionDefinition } from '../navigation'
import { PageHeader } from './PageHeader'

/** Standard page: header from the section definition, then vertically spaced content. */
export function PageLayout({ section, actions, children }: { section: SectionDefinition; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-8">
      <PageHeader title={section.label} description={section.description} icon={section.icon} actions={actions} />
      {children}
    </div>
  )
}

/** A numbered list of steps or points; plain text, no decorative cards. */
export function StepList({ items }: { items: { title: string; text: string }[] }) {
  return (
    <ol className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      {items.map((item, index) => (
        <li key={item.title} className="flex min-w-0 gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white text-xs font-semibold text-zinc-600" aria-hidden="true">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-zinc-900">{item.title}</p>
            <p className="mt-0.5 text-sm leading-6 text-zinc-600">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
