import { api } from './api'
import type { ContentItem, ProposalAttribute, ProposalModule, ProposalSourceReference, ProposalWarning } from './proposal.service'
import type { DecisionRequest, ProposalReview, ReviewLog, ReviewStatus } from './review.service'

/** Client types mirroring server/src/types/training.types.ts and training.service.ts (E5.5). */

export type Audience = 'sales' | 'customer_experience'

export interface ProfileCompetency { competencyId: string; name: string; description: string }
export interface CompetencyProfile { audience: Audience; label: string; purpose: string; competencies: ProfileCompetency[] }

export interface TrainingContent {
  title: string
  learningObjective: string
  prerequisites: ProposalAttribute
  estimatedDuration: ProposalAttribute
  competencies: { competencyId: string; name: string; rationale: string; claimIds: string[] }[]
  excludedCompetencies: { competencyId: string; reason: string }[]
  learningOutcomes: string[]
  productKnowledge: ContentItem[]
  modules: ProposalModule[]
}

export interface TrainingView {
  trainingId: string
  audience: Audience
  audienceLabel: string
  proposalId: string
  analysisId: string
  documentId: string
  profileVersion: string
  model: string
  promptVersion: string
  createdAt: string
  status: 'draft' | 'failed'
  lineage: { rootProposalId: string; proposalVersion: number; trainingVersion: number; previousTrainingId: string | null }
  content: TrainingContent | null
  sourceReferences: ProposalSourceReference[]
  warnings: ProposalWarning[]
  rejectedItems: { location: string; kind: string; text: string; reasons: string[] }[]
  validationErrors: string[]
  error: { code: string; message: string } | null
  reviewStatus: ReviewStatus | 'unavailable'
  proposalTitle: string | null
  proposalReviewStatus: ReviewStatus | 'unavailable'
}

export interface TrainingSummary {
  trainingId: string
  audience: Audience
  proposalId: string
  proposalVersion: number
  trainingVersion: number
  previousTrainingId: string | null
  status: 'draft' | 'failed'
  reviewStatus: ReviewStatus | 'unavailable'
  title: string | null
  learningObjective: string | null
  model: string
  createdAt: string
  counts: { competencies: number; modules: number; lessons: number; activities: number; assessments: number; warnings: number; pendingItems: number; requiresReview: number; rejectedItems: number }
  error: { code: string; message: string } | null
}

export interface AudienceTrainingState {
  audience: Audience
  label: string
  state: 'not_generated' | 'generating' | 'generated' | 'failed'
  current: TrainingSummary | null
  lastAttempt: TrainingSummary | null
  attempts: TrainingSummary[]
  canGenerate: boolean
}

export interface ProposalTrainings {
  proposalId: string
  proposalVersion: number
  proposalReviewStatus: ReviewStatus | 'unavailable'
  aiConfigured: boolean
  audiences: AudienceTrainingState[]
}

const enc = encodeURIComponent
export const getCompetencyProfiles = (signal?: AbortSignal) => api.get<{ profileVersion: string; profiles: CompetencyProfile[] }>('/competency-profiles', { signal })
export const getProposalTrainings = (proposalId: string, signal?: AbortSignal) => api.get<ProposalTrainings>(`/proposals/${enc(proposalId)}/trainings`, { signal })
export const generateTrainings = (proposalId: string, audiences?: Audience[]) => api.post<ProposalTrainings>(`/proposals/${enc(proposalId)}/trainings`, audiences ? { audiences } : {})
export const getTraining = (trainingId: string, signal?: AbortSignal) => api.get<TrainingView>(`/trainings/${enc(trainingId)}`, { signal })
export const getTrainingReviewLog = (trainingId: string, signal?: AbortSignal) => api.get<ReviewLog>(`/trainings/${enc(trainingId)}/reviews`, { signal })
export const submitTrainingDecision = (trainingId: string, request: DecisionRequest) => api.post<ProposalReview>(`/trainings/${enc(trainingId)}/reviews`, request)
/** Same-origin URL of the Markdown deliverable (served by the backend through the /api proxy). */
export const trainingDocumentUrl = (trainingId: string, download = false) => `/api/trainings/${enc(trainingId)}/document${download ? '?download=1' : ''}`
