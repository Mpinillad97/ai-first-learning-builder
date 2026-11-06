/** All backend calls go through this module. Paths are relative to /api, so the
 * Vite dev proxy (or a same-origin deployment) decides where they are served from. */

const API_BASE = '/api'

/** Thrown for network failures, non-2xx responses and invalid JSON. `status` is 0 when no HTTP response was received. */
export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Shape of error bodies produced by the backend error middleware. */
interface ApiErrorBody {
  error?: { message?: string }
}

async function parseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return undefined
  try {
    return await response.json()
  } catch {
    throw new ApiError('Invalid JSON in response', response.status)
  }
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init.headers },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Network error: unable to reach the API', 0)
  }

  const body = await parseJson(response)

  if (!response.ok) {
    const message =
      (body as ApiErrorBody | undefined)?.error?.message ??
      `Request failed with status ${response.status}`
    throw new ApiError(message, response.status)
  }

  if (body === undefined) {
    throw new ApiError('Expected a JSON response', response.status)
  }

  return body as T
}

export const api = {
  get: <T>(path: string, init?: RequestInit) => request<T>(path, { ...init, method: 'GET' }),
}
