import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useBackendHealth } from '../hooks/useBackendHealth'
import { Brand, SidebarContent } from './Sidebar'
import { CloseIcon, MenuIcon } from './icons'

/**
 * Layout: persistent sidebar from the md breakpoint (768px) up; below it, a top bar with a menu button
 * that opens the same navigation in a drawer.
 */
export function AppShell({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { state: connectionState } = useBackendHealth() // single poll shared by sidebar and drawer
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLDivElement>(null)

  const closeMenu = () => {
    setMenuOpen(false)
    menuButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!menuOpen) return
    const drawer = drawerRef.current
    drawer?.querySelector<HTMLElement>('a[aria-current="page"], a')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !drawer) return
      const focusable = [...drawer.querySelectorAll<HTMLElement>('a, button')]
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [menuOpen])

  // Close the drawer if the viewport grows past the mobile breakpoint.
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)')
    const onChange = () => query.matches && setMenuOpen(false)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return (
    <div className="min-h-svh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow">
        Saltar al contenido
      </a>

      {/* Desktop / tablet sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-zinc-200 bg-white md:block">
        <SidebarContent pathname={pathname} connectionState={connectionState} />
      </aside>

      {/* Mobile top bar */}
      <div data-print-hidden className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 md:hidden">
        <Brand />
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Abrir menú de navegación"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-100"
        >
          <MenuIcon />
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-zinc-900/30" onClick={closeMenu} aria-hidden="true" />
          <div
            ref={drawerRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Navegación"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-white shadow-xl"
          >
            <button
              type="button"
              onClick={closeMenu}
              aria-label="Cerrar menú de navegación"
              className="absolute top-2 right-2 inline-flex size-10 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100"
            >
              <CloseIcon />
            </button>
            <SidebarContent pathname={pathname} connectionState={connectionState} onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 md:pl-64">
        <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</div>
      </main>
    </div>
  )
}
