import { api } from './api'

/** Client types mirroring server/src/types/review.types.ts and ReviewLog (review.service.ts). */

export type ReviewDecision = 'approved' | 'rejected'
export type ReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'not_reviewable'

export interface ProposalReview {
  reviewId: string
  proposalId: string
  decision: ReviewDecision
  reason: string | null
  comment: string | null
  warningsAcknowledged: boolean
  warningCount: number
  pendingValidationItemCount: number
  previousReviewId: string | null
  decidedAt: string
}

export interface ReviewLog {
  proposalId: string
  reviewStatus: ReviewStatus
  /** Newest first. */
  reviews: ProposalReview[]
}

export interface DecisionRequest {
  decision: ReviewDecision
  reason?: string
  comment?: string
  acknowledgedWarnings?: boolean
  /** The latest decision the reviewer saw (null if none): the backend rejects decisions made on a stale view. */
  basedOnReviewId: string | null
}

const enc = encodeURIComponent
export const getReviewLog = (proposalId: string, signal?: AbortSignal) => api.get<ReviewLog>(`/proposals/${enc(proposalId)}/reviews`, { signal })
export const submitDecision = (proposalId: string, request: DecisionRequest) => api.post<ProposalReview>(`/proposals/${enc(proposalId)}/reviews`, request)
