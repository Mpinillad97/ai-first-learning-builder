import { useCallback } from 'react'
import { listProjectDocuments } from '../services/projects.service'
import { useApiResource } from './useApiResource'

/** Loads the selected project's documents (only those associated with it). `null` loads nothing. */
export function useProjectDocuments(projectId: string | null) {
  const load = useCallback((signal: AbortSignal) => listProjectDocuments(projectId!, signal), [projectId])
  return useApiResource(projectId, load)
}
