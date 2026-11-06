import type { ComponentType, ReactNode } from 'react'
import { InboxIcon, type IconProps } from './icons'

interface EmptyStateProps {
  title: string
  description: string
  icon?: ComponentType<IconProps>
  actions?: ReactNode
  /** Optional note shown under the actions (e.g. why an action is not available yet). */
  note?: string
}

/** Explains why a section is empty and what to do next. Never shows placeholder records. */
export function EmptyState({ title, description, icon: Icon = InboxIcon, actions, note }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Icon />
      </span>
      <h2 className="mt-4 text-base font-semibold text-zinc-900">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-6 text-zinc-600">{description}</p>
      {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
      {note && <p className="mt-3 max-w-md text-xs text-zinc-500">{note}</p>}
    </div>
  )
}
