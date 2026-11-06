import { api } from './api'
import type { SourceLocator } from './analysis.service'
import type { ReviewStatus } from './review.service'

/** Client types mirroring server/src/types/proposal.types.ts and ProposalSummary (proposal.service.ts). */

export interface ProposalAttribute {
  value: string
  status: 'supported' | 'pending_validation'
  claimIds: string[]
}

export interface ContentItem {
  kind: 'fact' | 'guidance' | 'pending_validation'
  text: string
  claimIds: string[]
  requiresReview: boolean
}

export interface Lesson { lessonId: string; order: number; title: string; content: ContentItem[] }
export interface Activity { activityId: string; title: string; instructions: string; claimIds: string[]; requiresReview: boolean }
export interface Assessment {
  assessmentId: string
  type: 'multiple_choice' | 'true_false' | 'open_question' | 'exercise'
  question: string
  options: string[]
  correctAnswer: string
  claimIds: string[]
  requiresReview: boolean
}

export interface ProposalSourceReference {
  claimId: string
  sourceId: string
  locator: SourceLocator
  quote: string
  startOffset: number
  endOffset: number
}

export interface ProposalModule {
  moduleId: string
  order: number
  title: string
  learningObjective: string
  suggestedDuration: ProposalAttribute
  lessons: Lesson[]
  activities: Activity[]
  assessments: Assessment[]
  claimIds: string[]
  evidence: ProposalSourceReference[]
}

export interface ProposalWarning {
  warningId: string
  type: 'contradiction' | 'documentation_gap' | 'pending_validation' | 'analysis_warning' | 'proposal'
  message: string
  relatedClaimIds: string[]
  relatedContradictionIds: string[]
  relatedGapIds: string[]
  requiresHumanReview: true
}

export interface LearningProposal {
  schemaVersion: 1
  proposalId: string
  analysisId: string
  documentId: string
  extractionId: string
  model: string
  promptVersion: string
  createdAt: string
  completedAt: string
  status: 'draft' | 'failed'
  content: {
    title: string
    learningObjective: string
    audience: ProposalAttribute
    prerequisites: ProposalAttribute
    estimatedDuration: ProposalAttribute
    modules: ProposalModule[]
  } | null
  sourceReferences: ProposalSourceReference[]
  warnings: ProposalWarning[]
  rejectedItems: { location: string; kind: string; text: string; reasons: string[] }[]
  validationErrors: string[]
  error: { code: string; message: string } | null
}

export interface ProposalSummary {
  proposalId: string
  analysisId: string
  status: 'draft' | 'failed'
  /** Effective human review status (E4.5); "unavailable" when the review log cannot be read. */
  reviewStatus: ReviewStatus | 'unavailable'
  model: string
  createdAt: string
  completedAt: string
  title: string | null
  counts: { modules: number; lessons: number; activities: number; assessments: number; warnings: number; rejectedItems: number; validationErrors: number }
  error: { code: string; message: string } | null
}

const enc = encodeURIComponent
export const generateProposal = (analysisId: string) => api.post<LearningProposal>(`/analyses/${enc(analysisId)}/proposals`, {})
export const listAnalysisProposals = (analysisId: string, signal?: AbortSignal) => api.get<ProposalSummary[]>(`/analyses/${enc(analysisId)}/proposals`, { signal })
export const getProposal = (proposalId: string, signal?: AbortSignal) => api.get<LearningProposal>(`/proposals/${enc(proposalId)}`, { signal })
