import { api } from './api'
import type { SourceLocator } from './analysis.service'
import type { DocumentRecord, DocumentStatus } from './projects.service'

/** Client types mirroring server/src/types/version.types.ts. */

export interface DocumentVersion {
  version: number
  documentId: string
  originalFilename: string
  uploadedAt: string
  status: DocumentStatus
  isCurrent: boolean
  document: DocumentRecord
}

export interface DocumentVersions {
  documentId: string
  projectId: string
  currentVersion: number
  versions: DocumentVersion[]
}

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged'

export interface ComparedUnit {
  version: number
  documentId: string
  extractionId: string
  locator: SourceLocator
  sourceId: string
  text: string
}

export interface DocumentChange {
  changeId: string
  type: ChangeType
  from?: ComparedUnit
  to?: ComparedUnit
  similarity?: number
  diff?: { type: 'equal' | 'removed' | 'added'; text: string }[]
}

export interface ComparedVersion {
  version: number
  documentId: string
  extractionId: string
  format: 'pdf' | 'docx'
  unitCount: number
  emptyUnitCount: number
}

export interface DocumentComparison {
  documentId: string
  projectId: string
  algorithm: string
  comparedAt: string
  from: ComparedVersion
  to: ComparedVersion
  summary: Record<ChangeType, number>
  changes: DocumentChange[]
}

const enc = encodeURIComponent
const base = (projectId: string, documentId: string) => `/projects/${enc(projectId)}/documents/${enc(documentId)}`

export const listVersions = (projectId: string, documentId: string, signal?: AbortSignal) =>
  api.get<DocumentVersions>(`${base(projectId, documentId)}/versions`, { signal })

export function uploadVersion(projectId: string, documentId: string, file: File): Promise<DocumentVersion> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm<DocumentVersion>(`${base(projectId, documentId)}/versions`, form)
}

export const compareVersions = (projectId: string, documentId: string, from: number, to: number, signal?: AbortSignal) =>
  api.get<DocumentComparison>(`${base(projectId, documentId)}/comparison?from=${from}&to=${to}`, { signal })
