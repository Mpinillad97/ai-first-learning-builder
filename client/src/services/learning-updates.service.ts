import { api } from './api'
import type { ImpactEvidence, ImpactLevel, ImpactVersionRef, LearningElementType } from './impact.service'
import type { ProposalReview, ReviewStatus, DecisionRequest } from './review.service'

/** Client types mirroring server/src/types/update.types.ts and update.service.ts. */

export type UpdateOperationType = 'add' | 'modify' | 'remove'

export type ElementContent =
  | { elementType: 'module'; title: string; learningObjective: string }
  | { elementType: 'lesson'; title: string; content: { kind: 'fact' | 'guidance' | 'pending_validation'; text: string; requiresReview: boolean }[] }
  | { elementType: 'activity'; title: string; instructions: string }
  | { elementType: 'assessment'; type: string; question: string; options: string[]; correctAnswer: string }

export interface UpdateOperation {
  operationId: string
  operation: UpdateOperationType
  elementType: LearningElementType
  elementId: string
  moduleId: string
  previous: ElementContent | null
  proposed: ElementContent | null
  justification: string
  changeIds: string[]
  impactLevel: Exclude<ImpactLevel, 'no_impact'>
  references: ImpactEvidence[]
  requiresReview: boolean
  reviewNotes: ('pending_validation_content' | 'unresolved_issue')[]
}

export type NotUpdatedReason = 'no_impact' | 'uncertain' | 'not_assessed' | 'no_operation'

export interface LearningUpdate {
  updateId: string
  projectId: string
  documentId: string
  from: ImpactVersionRef
  to: ImpactVersionRef
  comparisonId: string
  impactAnalysisId: string
  sourceProposalId: string
  sourceProposalVersion: number
  rootProposalId: string
  proposalVersion: number
  candidateProposalId: string | null
  model: string
  promptVersion: string
  createdAt: string
  completedAt: string
  status: 'completed' | 'failed'
  operations: UpdateOperation[]
  keptForReview: { elementId: string; elementType: LearningElementType; moduleId: string; title: string; reason: string; changeIds: string[] }[]
  notUpdatedChanges: { changeId: string; impact: ImpactLevel | null; certainty: 'supported' | 'uncertain'; reason: NotUpdatedReason }[]
  unchangedElementIds: string[]
  rejectedOperations: { index: number; operation: string | null; elementId: string | null; reasons: string[] }[]
  warnings: { source: 'backend' | 'ai'; code: string | null; message: string; elementIds: string[] }[]
  validationErrors: string[]
  error: { code: string; message: string } | null
  reviewStatus: ReviewStatus | 'unavailable' | null
  reviews: ProposalReview[]
  isCurrent: boolean
}

export interface LearningUpdateSummary {
  updateId: string
  impactAnalysisId: string
  from: ImpactVersionRef
  to: ImpactVersionRef
  sourceProposalId: string
  sourceProposalVersion: number
  proposalVersion: number
  candidateProposalId: string | null
  status: 'completed' | 'failed'
  reviewStatus: ReviewStatus | 'unavailable' | null
  isCurrent: boolean
  model: string
  createdAt: string
  counts: { add: number; modify: number; remove: number; keptForReview: number; notUpdated: number; warnings: number }
  error: { code: string; message: string } | null
}

export interface ProposalVersions {
  rootProposalId: string
  currentProposalId: string
  currentVersion: number
  versions: {
    proposalVersion: number
    proposalId: string
    parentProposalId: string | null
    updateId: string | null
    documentVersion: number | null
    reviewStatus: ReviewStatus | 'unavailable'
    isCurrent: boolean
    title: string | null
    createdAt: string
  }[]
}

const enc = encodeURIComponent
const base = (projectId: string, documentId: string) => `/projects/${enc(projectId)}/documents/${enc(documentId)}/learning-updates`

export const generateLearningUpdate = (projectId: string, documentId: string, impactAnalysisId: string) =>
  api.post<LearningUpdate>(base(projectId, documentId), { impactAnalysisId })

export const listLearningUpdates = (projectId: string, documentId: string, impactAnalysisId: string, signal?: AbortSignal) =>
  api.get<LearningUpdateSummary[]>(`${base(projectId, documentId)}?impactAnalysisId=${enc(impactAnalysisId)}`, { signal })

export const getLearningUpdate = (updateId: string, signal?: AbortSignal) => api.get<LearningUpdate>(`/learning-updates/${enc(updateId)}`, { signal })

export const reviewLearningUpdate = (projectId: string, documentId: string, updateId: string, request: DecisionRequest) =>
  api.post<ProposalReview>(`${base(projectId, documentId)}/${enc(updateId)}/reviews`, request)

export const getProposalVersions = (proposalId: string, signal?: AbortSignal) => api.get<ProposalVersions>(`/proposals/${enc(proposalId)}/versions`, { signal })
