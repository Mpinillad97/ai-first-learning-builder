import { api } from './api'
import type { SourceLocator } from './analysis.service'
import type { ProposalSummary } from './proposal.service'
import type { ReviewStatus } from './review.service'

/** Client types mirroring server/src/types/impact.types.ts and impact.service.ts. */

export type ImpactLevel = 'high' | 'medium' | 'low' | 'no_impact'
export type ImpactReviewReason = 'uncertain' | 'not_assessed' | 'unresolved_issue' | 'no_element_identified' | 'linked_elements_not_listed' | 'element_requires_review'
export type LearningElementType = 'module' | 'lesson' | 'activity' | 'assessment'

export interface ImpactElementRef {
  elementId: string
  elementType: LearningElementType
  moduleId: string
  title: string
}

export interface ImpactEvidence {
  sourceId: string
  version: number
  documentId: string
  extractionId: string
  locator: SourceLocator
  text: string
}

export interface ImpactResult {
  changeId: string
  changeType: 'added' | 'removed' | 'modified'
  impact: ImpactLevel | null
  certainty: 'supported' | 'uncertain'
  justification: string
  reviewRecommendation: string
  affectedElements: ImpactElementRef[]
  evidence: ImpactEvidence[]
  linkedElementIds: string[]
  requiresHumanReview: boolean
  reviewReasons: ImpactReviewReason[]
  origin: 'ai' | 'backend'
}

export interface ImpactVersionRef {
  version: number
  documentId: string
  extractionId: string
}

export type ImpactSummaryCounts = Record<ImpactLevel | 'not_assessed' | 'requiresHumanReview', number>

export interface ImpactAnalysis {
  impactAnalysisId: string
  projectId: string
  documentId: string
  from: ImpactVersionRef
  to: ImpactVersionRef
  comparisonId: string
  proposalId: string
  proposalReviewStatus: ReviewStatus | 'unavailable'
  model: string
  promptVersion: string
  createdAt: string
  completedAt: string
  status: 'completed' | 'failed'
  results: ImpactResult[]
  affectedElements: (ImpactElementRef & { highestImpact: Exclude<ImpactLevel, 'no_impact'>; changeIds: string[] })[]
  summary: ImpactSummaryCounts
  rejectedResults: { changeId: string | null; reasons: string[] }[]
  /** Backend warnings have a code; AI warnings are free text (code null). */
  warnings: { source: 'backend' | 'ai'; code: string | null; message: string }[]
  validationErrors: string[]
  error: { code: string; message: string } | null
}

export interface ImpactAnalysisSummary {
  impactAnalysisId: string
  from: ImpactVersionRef
  to: ImpactVersionRef
  proposalId: string
  proposalReviewStatus: ReviewStatus | 'unavailable'
  status: 'completed' | 'failed'
  model: string
  createdAt: string
  summary: ImpactSummaryCounts
  affectedElementCount: number
  error: { code: string; message: string } | null
}

export interface CompatibleProposals {
  version: number
  documentId: string
  extractionId: string | null
  proposals: ProposalSummary[]
}

const enc = encodeURIComponent
const base = (projectId: string, documentId: string) => `/projects/${enc(projectId)}/documents/${enc(documentId)}`

export const listCompatibleProposals = (projectId: string, documentId: string, version: number, signal?: AbortSignal) =>
  api.get<CompatibleProposals>(`${base(projectId, documentId)}/versions/${version}/proposals`, { signal })

export const createImpactAnalysis = (projectId: string, documentId: string, from: number, to: number, proposalId: string) =>
  api.post<ImpactAnalysis>(`${base(projectId, documentId)}/impact-analyses`, { from, to, proposalId })

export const listImpactAnalyses = (projectId: string, documentId: string, from: number, to: number, signal?: AbortSignal) =>
  api.get<ImpactAnalysisSummary[]>(`${base(projectId, documentId)}/impact-analyses?from=${from}&to=${to}`, { signal })

export const getImpactAnalysis = (id: string, signal?: AbortSignal) => api.get<ImpactAnalysis>(`/impact-analyses/${enc(id)}`, { signal })
