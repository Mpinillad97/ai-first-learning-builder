import { useCallback, useEffect, useRef, useState } from 'react'

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

interface Loaded<T> {
  key: string
  status: 'ready' | 'error'
  data: T | undefined
  error: unknown
}

/**
 * Loads data for `key` from the API and reloads on demand. Data loaded for another key is never returned
 * (switching keys always shows "loading" first), stale responses are ignored, and a reload keeps the
 * current data visible until the new response arrives. `key = null` means nothing to load ("idle").
 */
export function useApiResource<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const [version, setVersion] = useState(0)
  const [reloading, setReloading] = useState(false)
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load // declared before the loading effect, so it runs first
  })

  const reload = useCallback(() => {
    setReloading(true)
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    if (key === null) return
    const controller = new AbortController()
    loadRef.current(controller.signal)
      .then((data) => setLoaded({ key, status: 'ready', data, error: null }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoaded((prev) => ({ key, status: 'error', data: prev?.key === key ? prev.data : undefined, error }))
      })
      .finally(() => {
        if (!controller.signal.aborted) setReloading(false)
      })
    return () => controller.abort()
  }, [key, version])

  const current = loaded && loaded.key === key ? loaded : null
  const status: ResourceStatus = key === null ? 'idle' : current ? current.status : 'loading'
  return { status, data: current?.data, error: current?.error ?? null, reloading: reloading && current !== null, reload }
}
