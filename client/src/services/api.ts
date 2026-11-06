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
  /** JSON body. */
  post: <T>(path: string, body: unknown, init?: RequestInit) =>
    request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...init?.headers } }),
  /** multipart/form-data body; the browser sets the boundary header. */
  postForm: <T>(path: string, form: FormData, init?: RequestInit) => request<T>(path, { ...init, method: 'POST', body: form }),
}

/** A user-facing description of an API failure: a Spanish summary for unreachable APIs, else the backend message. */
export function errorDetail(error: unknown): string {
  if (isUnreachable(error)) return 'No se pudo conectar con el servidor. Verifica que la API esté en ejecución.'
  return error instanceof Error && error.message ? error.message : 'Error desconocido.'
}

/**
 * True when the API could not be reached: no HTTP response at all, or a 502/504 without a backend error body
 * (the dev proxy's answer when the backend is down; backend errors always carry a JSON message).
 */
export function isUnreachable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false
  return error.status === 0 || ((error.status === 502 || error.status === 504) && error.message === `Request failed with status ${error.status}`)
}
