import { api } from './api'

/** Mirrors the backend Project model (server/src/types/project.types.ts). */
export interface Project {
  id: string
  name: string
  product: string
  audience: string
  learningObjective: string
  context: string
  documentIds: string[]
  createdAt: string
  updatedAt: string
}

export type ProjectInput = Pick<Project, 'name' | 'product' | 'audience' | 'learningObjective' | 'context'>

/** Same limits as the backend. name and product are required. */
export const PROJECT_FIELD_LIMITS: Record<keyof ProjectInput, number> = {
  name: 120,
  product: 120,
  audience: 300,
  learningObjective: 1000,
  context: 4000,
}

export type DocumentStatus = 'uploaded' | 'processing' | 'processed' | 'failed'

/** Mirrors the backend DocumentRecord (fields the UI uses). */
export interface DocumentRecord {
  id: string
  originalFilename: string
  extension: string
  mimeType: string
  sizeBytes: number
  status: DocumentStatus
  createdAt: string
  updatedAt: string
}

/** Same rules as the backend upload validation. */
export const UPLOAD_RULES = {
  extensions: ['.pdf', '.docx'],
  accept: '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  maxBytes: 15 * 1024 * 1024,
} as const

export const listProjects = (signal?: AbortSignal) => api.get<Project[]>('/projects', { signal })

export const createProject = (input: ProjectInput) => api.post<Project>('/projects', input)

export const listProjectDocuments = (projectId: string, signal?: AbortSignal) =>
  api.get<DocumentRecord[]>(`/projects/${encodeURIComponent(projectId)}/documents`, { signal })

export function uploadProjectDocument(projectId: string, file: File): Promise<DocumentRecord> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm<DocumentRecord>(`/projects/${encodeURIComponent(projectId)}/documents`, form)
}
