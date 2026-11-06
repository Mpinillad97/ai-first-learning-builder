import { useEffect, useRef } from 'react'
import { setSearchParams, useSearch } from '../router'

/**
 * Remembers a section's selection (its query string) for the browser session and restores it when the
 * section is opened without its main parameter (e.g. from the sidebar).
 */
export function useRememberedView(storageKey: string, mainParam: string): void {
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    if (new URLSearchParams(window.location.search).has(mainParam)) return
    try {
      const saved = sessionStorage.getItem(storageKey)
      // setSearchParams notifies the router, so the restored selection renders immediately.
      if (saved) setSearchParams(Object.fromEntries(new URLSearchParams(saved)))
    } catch { /* storage unavailable: start without a remembered view */ }
  }, [storageKey, mainParam])

  const search = useSearch()
  useEffect(() => {
    try {
      if (search) sessionStorage.setItem(storageKey, search)
    } catch { /* ignore */ }
  }, [storageKey, search])
}
