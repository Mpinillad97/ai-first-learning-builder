import type { ConnectionState } from '../hooks/useBackendHealth'
import { NAVIGATION, PRODUCT_NAME } from '../navigation'
import { NavItem } from './NavItem'
import { StatusIndicator, type StatusTone } from './StatusIndicator'

const CONNECTION: Record<ConnectionState, { tone: StatusTone; label: string }> = {
  loading: { tone: 'neutral', label: 'Comprobando conexión…' },
  connected: { tone: 'success', label: 'API conectada' },
  disconnected: { tone: 'danger', label: 'API no disponible' },
}

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[11px] font-bold tracking-wide text-white" aria-hidden="true">
        LB
      </span>
      <span className="truncate text-sm font-semibold text-zinc-900">{PRODUCT_NAME}</span>
    </div>
  )
}

/** Navigation content shared by the desktop sidebar and the mobile drawer. */
export function SidebarContent({ pathname, connectionState, onNavigate }: { pathname: string; connectionState: ConnectionState; onNavigate?: () => void }) {
  const connection = CONNECTION[connectionState]
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Brand />
      </div>
      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-2">
        <ul className="space-y-0.5">
          {NAVIGATION.map((section) => (
            <li key={section.path}>
              <NavItem to={section.path} label={section.label} icon={section.icon} active={pathname === section.path} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </nav>
      <div className="shrink-0 border-t border-zinc-200 px-4 py-3">
        <StatusIndicator tone={connection.tone} label={connection.label} live />
      </div>
    </div>
  )
}
