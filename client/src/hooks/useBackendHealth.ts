import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../services/api'
import { getHealth } from '../services/health.service'

export type ConnectionState = 'loading' | 'connected' | 'disconnected'

export interface BackendHealth {
  state: ConnectionState
  message: string
  lastChecked: Date | null
  checking: boolean
  recheck: () => void
}

const POLL_INTERVAL_MS = 5000

/** Polls GET /api/health so the UI reflects the real backend status, including reconnection. */
export function useBackendHealth(): BackendHealth {
  const [state, setState] = useState<ConnectionState>('loading')
  const [message, setMessage] = useState('Checking backend connection…')
  const [lastChecked, setLastChecked] = useState<Date | null>(null)
  const [checking, setChecking] = useState(true)
  // Incrementing this triggers a new check (from the poll timer or the "Check again" button).
  const [requestId, setRequestId] = useState(0)

  const recheck = useCallback(() => {
    setChecking(true)
    setRequestId((id) => id + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let pollTimer: number | undefined

    getHealth(controller.signal)
      .then((health) => {
        setState('connected')
        setMessage(health.message)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState('disconnected')
        setMessage(error instanceof ApiError ? error.message : 'Unexpected error')
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setChecking(false)
        setLastChecked(new Date())
        pollTimer = window.setTimeout(recheck, POLL_INTERVAL_MS)
      })

    return () => {
      controller.abort()
      window.clearTimeout(pollTimer)
    }
  }, [requestId, recheck])

  return { state, message, lastChecked, checking, recheck }
}
