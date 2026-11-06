import type { ComponentType, ReactNode } from 'react'
import type { IconProps } from './icons'

interface PageHeaderProps {
  title: string
  description: string
  icon?: ComponentType<IconProps>
  actions?: ReactNode
}

/** Page title, contextual description and optional actions. The h1 receives focus after navigation. */
export function PageHeader({ title, description, icon: Icon, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        {Icon && (
          <span className="mt-0.5 hidden size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 sm:inline-flex">
            <Icon />
          </span>
        )}
        <div className="min-w-0">
          <h1 id="page-title" tabIndex={-1} className="text-xl font-semibold tracking-tight text-zinc-900 outline-none sm:text-2xl">
            {title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-600">{description}</p>
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
