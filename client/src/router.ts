import { useSyncExternalStore } from 'react'

/**
 * Minimal client-side router on the History API (no routing dependency). Vite's dev server and
 * `vite preview` serve index.html for unknown paths, so refreshing any route works.
 */

const NAVIGATE_EVENT = 'app:navigate'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATE_EVENT, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATE_EVENT, onChange)
  }
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

/** The whole query string of the current URL, reactive like usePathname. */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

/** A query-string parameter of the current URL, reactive like usePathname. */
export function useSearchParam(name: string): string | null {
  const search = useSyncExternalStore(subscribe, () => window.location.search)
  return new URLSearchParams(search).get(name)
}

/** Sets (or removes, with null) a query parameter without adding a history entry. */
export function setSearchParam(name: string, value: string | null): void {
  setSearchParams({ [name]: value })
}

/** Sets or removes several query parameters at once, without adding a history entry. */
export function setSearchParams(values: Record<string, string | null>): void {
  const url = new URL(window.location.href)
  for (const [name, value] of Object.entries(values)) {
    if (value === null) url.searchParams.delete(name)
    else url.searchParams.set(name, value)
  }
  if (url.href === window.location.href) return
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === window.location.pathname) return
  if (options.replace) window.history.replaceState(null, '', to)
  else window.history.pushState(null, '', to)
  window.dispatchEvent(new Event(NAVIGATE_EVENT))
}
