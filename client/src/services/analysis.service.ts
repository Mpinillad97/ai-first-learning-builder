import { api } from './api'

/**
 * Client types mirroring the backend contracts:
 * server/src/services/processing.service.ts (ProcessingSummary), server/src/types/extraction.types.ts,
 * server/src/types/analysis.types.ts, server/src/types/source.types.ts and AnalysisSummary
 * (server/src/services/analysis.service.ts).
 */

export type ProcessingSummary = {
  documentId: string
  status: 'processed'
  format: 'pdf' | 'docx'
  extractionId: string
  reusedExisting: boolean
  extractedAt: string
  characterCount: number
} & ({ pageCount: number; pagesWithText: number } | { paragraphCount: number })

export interface Extraction {
  documentId: string
  format: 'pdf' | 'docx'
  extractedAt: string
  fullText: string
  /** Absent on legacy extractions, which cannot be analyzed. */
  extractionId?: string
  pages?: { pageNumber: number; text: string }[]
  paragraphs?: { paragraphIndex: number; text: string }[]
}

export type SourceLocator = { type: 'pdf-page'; pageNumber: number } | { type: 'docx-paragraph'; paragraphIndex: number }

export interface Evidence {
  sourceId: string
  locator: SourceLocator
  quote: string
  startOffset: number
  endOffset: number
}

export interface Claim {
  claimId: string
  text: string
  status: 'confirmed' | 'pending_validation'
  evidence: Evidence[]
}

export interface RejectedClaim {
  text: string
  status: string
  evidence: { sourceId: string; quote: string }[]
  reasons: string[]
  categories?: string[]
}

export interface Contradiction {
  contradictionId: string
  description: string
  severity: 'high' | 'medium' | 'low'
  claimIds: string[]
  evidence: Evidence[]
  status: 'pending_review'
}

export interface DocumentationGap {
  gapId: string
  topic: string
  category: string
  description: string
  relevance: string
  status: 'not_documented'
  relatedEvidence: Evidence[]
}

export interface RejectedItem {
  reasons: string[]
  description?: string
  topic?: string
}

export interface Analysis {
  schemaVersion?: 2
  analysisId: string
  documentId: string
  extractionId: string
  model: string
  promptVersion: string
  createdAt: string
  completedAt: string
  status: 'completed' | 'failed'
  claims: Claim[]
  rejectedClaims: RejectedClaim[]
  contradictions?: Contradiction[]
  rejectedContradictions?: RejectedItem[]
  documentationGaps?: DocumentationGap[]
  rejectedGaps?: RejectedItem[]
  warnings: string[]
  error: { code: string; message: string } | null
}

export interface AnalysisSummary {
  analysisId: string
  documentId: string
  extractionId: string
  schemaVersion: number
  status: 'completed' | 'failed'
  model: string
  createdAt: string
  completedAt: string
  counts: {
    claims: number
    confirmed: number
    pendingValidation: number
    rejectedClaims: number
    contradictions: number | null
    documentationGaps: number | null
  }
  error: { code: string; message: string } | null
}

export interface SourceFragment {
  sourceId: string
  documentId: string
  extractionId: string
  locator: SourceLocator
  text: string
  isCurrent: boolean
}

const enc = encodeURIComponent

export const processDocument = (documentId: string) => api.post<ProcessingSummary>(`/documents/${enc(documentId)}/process`, {})
export const getExtraction = (documentId: string, signal?: AbortSignal) => api.get<Extraction>(`/documents/${enc(documentId)}/extraction`, { signal })
export const startAnalysis = (documentId: string) => api.post<Analysis>(`/documents/${enc(documentId)}/analyses`, {})
export const listDocumentAnalyses = (documentId: string, signal?: AbortSignal) => api.get<AnalysisSummary[]>(`/documents/${enc(documentId)}/analyses`, { signal })
export const getAnalysis = (analysisId: string, signal?: AbortSignal) => api.get<Analysis>(`/analyses/${enc(analysisId)}`, { signal })

/** Sources are immutable per extraction, so each one is fetched at most once per session. */
const sourceCache = new Map<string, Promise<SourceFragment>>()
export function getSource(sourceId: string): Promise<SourceFragment> {
  let pending = sourceCache.get(sourceId)
  if (!pending) {
    pending = api.get<SourceFragment>(`/sources/${enc(sourceId)}`)
    pending.catch(() => sourceCache.delete(sourceId)) // allow retry after a failure
    sourceCache.set(sourceId, pending)
  }
  return pending
}
