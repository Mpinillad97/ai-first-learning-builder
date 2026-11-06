import { api } from './api'

export interface HealthResponse {
  status: 'ok'
  message: string
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return api.get<HealthResponse>('/health', { signal })
}
