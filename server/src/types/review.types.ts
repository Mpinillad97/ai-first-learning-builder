/** A human decision on a learning proposal. Only ever created through an explicit API request. */
export type ReviewDecision = 'approved' | 'rejected';

/**
 * Effective review status of a proposal, derived from its review log (never stored on the proposal):
 *   pending_review: a draft without decisions.
 *   approved / rejected: the latest decision.
 *   not_reviewable: a failed generation attempt (critical validation errors, no content).
 */
export type ReviewStatus = 'pending_review' | 'approved' | 'rejected' | 'not_reviewable';

/** One immutable review record: <reviewsDir>/<proposalId>/<reviewId>.json. */
export interface ProposalReview {
  schemaVersion: 1;
  reviewId: string;
  proposalId: string;
  /** E5.5: only on training reviews (the proposalId is then the training's source proposal). */
  trainingId?: string;
  analysisId: string;
  documentId: string;
  decision: ReviewDecision;
  /** Required for rejections; null for approvals. */
  reason: string | null;
  /** Optional reviewer note. */
  comment: string | null;
  /** The reviewer confirmed having reviewed the proposal's warnings and pending-validation content. */
  warningsAcknowledged: boolean;
  /** Snapshot of what the reviewer was shown, for audit. */
  warningCount: number;
  pendingValidationItemCount: number;
  /** The decision this one replaces (null for the first decision): the log is a chain. */
  previousReviewId: string | null;
  /** ISO 8601. */
  decidedAt: string;
}

export const REVIEW_TEXT_LIMIT = 2_000;
