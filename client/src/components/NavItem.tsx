import type { ComponentType } from 'react'
import { Link } from './Link'
import type { IconProps } from './icons'

interface NavItemProps {
  to: string
  label: string
  icon: ComponentType<IconProps>
  active: boolean
  onNavigate?: () => void
}

export function NavItem({ to, label, icon: Icon, active, onNavigate }: NavItemProps) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex min-h-9 items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-zinc-100 text-zinc-900' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'
      }`}
    >
      {active && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-600" aria-hidden="true" />}
      <Icon className={`shrink-0 ${active ? 'text-accent-600' : 'text-zinc-400 group-hover:text-zinc-600'}`} />
      <span className="truncate">{label}</span>
    </Link>
  )
}
