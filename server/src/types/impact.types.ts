import type { AnalysisErrorCode } from './analysis.types.js';
import type { ReviewStatus } from './review.types.js';
import type { SourceLocator } from './source.types.js';
import type { ChangeType } from './version.types.js';

export const IMPACT_LEVELS = ['high', 'medium', 'low', 'no_impact'] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];

/** supported: the model could relate the change to the learning content; uncertain: it could not establish it. */
export const IMPACT_CERTAINTIES = ['supported', 'uncertain'] as const;
export type ImpactCertainty = (typeof IMPACT_CERTAINTIES)[number];

export type LearningElementType = 'module' | 'lesson' | 'activity' | 'assessment';

export interface ImpactElementRef {
  elementId: string;
  elementType: LearningElementType;
  /** Module containing the element (the module itself for modules). */
  moduleId: string;
  title: string;
}

/** A source passage of one of the compared versions, resolved through GET /api/sources/:sourceId. */
export interface ImpactEvidence {
  sourceId: string;
  version: number;
  documentId: string;
  extractionId: string;
  locator: SourceLocator;
  text: string;
}

/**
 * Why a result needs human review (backend-derived):
 *   uncertain:             the model could not establish the relation.
 *   not_assessed:          no valid model assessment exists for the change.
 *   unresolved_issue:      affected or linked content depends on pending-validation or contradicted claims.
 *   no_element_identified: an impact without any affected element.
 *   linked_elements_not_listed: elements cite the previous text but the assessment does not list them.
 *   element_requires_review: an affected element was already flagged for review in the proposal.
 */
export const REVIEW_REASONS = ['uncertain', 'not_assessed', 'unresolved_issue', 'no_element_identified', 'linked_elements_not_listed', 'element_requires_review'] as const;
export type ImpactReviewReason = (typeof REVIEW_REASONS)[number];

export interface ImpactResult {
  /** changeId from the E5.1 comparison. */
  changeId: string;
  changeType: Exclude<ChangeType, 'unchanged'>;
  /** null when no valid assessment exists for this change (it was not assessed or its assessment was rejected). */
  impact: ImpactLevel | null;
  certainty: ImpactCertainty;
  justification: string;
  /** Recommendation for the reviewer; never replacement content. */
  reviewRecommendation: string;
  affectedElements: ImpactElementRef[];
  /** Always includes the change's own passages (backend-derived), plus validated passages cited by the model. */
  evidence: ImpactEvidence[];
  /** Elements whose claims cite the previous text of this change (backend-derived, independent of the model). */
  linkedElementIds: string[];
  requiresHumanReview: boolean;
  reviewReasons: ImpactReviewReason[];
  /** "ai": validated model assessment; "backend": placeholder for a change without a valid assessment. */
  origin: 'ai' | 'backend';
}

/** Model output removed by validation, kept for audit. */
export interface RejectedImpactResult {
  changeId: string | null;
  reasons: string[];
}

export interface AffectedElementSummary extends ImpactElementRef {
  /** Highest impact level among the results that list it. */
  highestImpact: Exclude<ImpactLevel, 'no_impact'>;
  changeIds: string[];
}

export const IMPACT_WARNING_CODES = ['proposal_rejected', 'proposal_pending_review', 'review_status_unavailable', 'source_analysis_unavailable', 'rejected_results', 'not_assessed'] as const;
export type ImpactWarningCode = (typeof IMPACT_WARNING_CODES)[number];

/** Backend warnings carry a code (clients can localize them); model warnings are free text with code null. */
export interface ImpactWarning {
  source: 'backend' | 'ai';
  code: ImpactWarningCode | null;
  message: string;
}

export type ImpactAnalysisStatus = 'completed' | 'failed';

export interface ImpactVersionRef {
  version: number;
  documentId: string;
  extractionId: string;
}

export const IMPACT_SCHEMA_VERSION = 1 as const;

/** One immutable impact analysis: <impactAnalysesDir>/<impactAnalysisId>.json. */
export interface ImpactAnalysis {
  schemaVersion: 1;
  impactAnalysisId: string;
  projectId: string;
  /** Logical document (id of version 1). */
  documentId: string;
  from: ImpactVersionRef;
  to: ImpactVersionRef;
  /** Deterministic id of the E5.1 comparison (algorithm + both extraction ids). */
  comparisonId: string;
  comparisonAlgorithm: string;
  proposalId: string;
  /** Review status of the proposal when the analysis ran (snapshot for audit). */
  proposalReviewStatus: ReviewStatus | 'unavailable';
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string;
  status: ImpactAnalysisStatus;
  /** One per changed unit (added/removed/modified), in document order; empty for failed attempts. */
  results: ImpactResult[];
  affectedElements: AffectedElementSummary[];
  summary: Record<ImpactLevel | 'not_assessed' | 'requiresHumanReview', number>;
  rejectedResults: RejectedImpactResult[];
  warnings: ImpactWarning[];
  /** Problems that made the attempt fail; empty for completed analyses. */
  validationErrors: string[];
  error: { code: AnalysisErrorCode; message: string } | null;
}
