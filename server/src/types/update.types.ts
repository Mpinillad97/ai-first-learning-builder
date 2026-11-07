import type { AnalysisErrorCode } from './analysis.types.js';
import type { ImpactEvidence, ImpactLevel, ImpactVersionRef, LearningElementType } from './impact.types.js';
import type { AssessmentType, ContentKind } from './proposal.types.js';
import type { ProposalReview, ReviewStatus } from './review.types.js';

export const UPDATE_OPERATIONS = ['add', 'modify', 'remove'] as const;
export type UpdateOperationType = (typeof UPDATE_OPERATIONS)[number];

/** Content of one learning element as shown to a reviewer (before or after the update). */
export type ElementContent =
  | { elementType: 'module'; title: string; learningObjective: string }
  | { elementType: 'lesson'; title: string; content: { kind: ContentKind; text: string; requiresReview: boolean }[] }
  | { elementType: 'activity'; title: string; instructions: string }
  | { elementType: 'assessment'; type: AssessmentType; question: string; options: string[]; correctAnswer: string };

/** pending_validation_content: the proposed content keeps pending information; unresolved_issue: it involves pending/contradicted claims. */
export type OperationReviewNote = 'pending_validation_content' | 'unresolved_issue';

export interface UpdateOperation {
  operationId: string;
  operation: UpdateOperationType;
  elementType: LearningElementType;
  /** Existing id (modify/remove) or the id assigned to the new element (add). */
  elementId: string;
  /** Module containing the element (the module itself for modules). */
  moduleId: string;
  previous: ElementContent | null;
  proposed: ElementContent | null;
  justification: string;
  /** E5.1 change ids (actionable results of the impact analysis). */
  changeIds: string[];
  /** Highest impact among the cited changes. */
  impactLevel: Exclude<ImpactLevel, 'no_impact'>;
  /** Verified passages of the cited changes, resolved through GET /api/sources/:sourceId. */
  references: ImpactEvidence[];
  requiresReview: boolean;
  reviewNotes: OperationReviewNote[];
}

/**
 * Why a changed unit of the impact analysis did not lead to a content operation:
 *   no_impact / uncertain / not_assessed: excluded by rule (never turned into content changes automatically).
 *   no_operation: actionable, but the model proposed no (valid) operation for it; content kept.
 */
export type NotUpdatedReason = 'no_impact' | 'uncertain' | 'not_assessed' | 'no_operation';

export const UPDATE_WARNING_CODES = [
  'stale_evidence', // a kept element cites claims whose evidence is not in the new version
  'flagged_uncertain', // elements of uncertain impact results were flagged for review
  'kept_for_review', // the model kept elements unchanged and flagged them for review
  'rejected_operations', // model operations failed validation
  'downgraded_attribute', // a supported attribute lost its evidence and became pending_validation
  'empty_module', // a module was left without lessons
] as const;
export type UpdateWarningCode = (typeof UPDATE_WARNING_CODES)[number];

export interface UpdateWarning {
  source: 'backend' | 'ai';
  code: UpdateWarningCode | null;
  message: string;
  elementIds: string[];
}

export type LearningUpdateStatus = 'completed' | 'failed';

export const UPDATE_SCHEMA_VERSION = 1 as const;

/** One immutable learning update: <learningUpdatesDir>/<updateId>.json. */
export interface LearningUpdate {
  schemaVersion: 1;
  updateId: string;
  projectId: string;
  /** Logical document (id of version 1). */
  documentId: string;
  from: ImpactVersionRef;
  to: ImpactVersionRef;
  comparisonId: string;
  impactAnalysisId: string;
  /** The proposal version that was updated. */
  sourceProposalId: string;
  sourceProposalVersion: number;
  rootProposalId: string;
  /** Version number of the resulting proposal (sourceProposalVersion + 1). */
  proposalVersion: number;
  /** The new proposal version (a separate immutable proposal record); null for failed attempts. */
  candidateProposalId: string | null;
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string;
  status: LearningUpdateStatus;
  operations: UpdateOperation[];
  keptForReview: { elementId: string; elementType: LearningElementType; moduleId: string; title: string; reason: string; changeIds: string[] }[];
  notUpdatedChanges: { changeId: string; impact: ImpactLevel | null; certainty: 'supported' | 'uncertain'; reason: NotUpdatedReason }[];
  /** Elements of the source proposal kept as they were (ids are preserved in the new version). */
  unchangedElementIds: string[];
  rejectedOperations: { index: number; operation: string | null; elementId: string | null; reasons: string[] }[];
  warnings: UpdateWarning[];
  validationErrors: string[];
  error: { code: AnalysisErrorCode; message: string } | null;
}

/** API view: the stored update plus its human review (from the E4.5 review log of the candidate proposal). */
export interface LearningUpdateView extends LearningUpdate {
  reviewStatus: ReviewStatus | 'unavailable' | null;
  reviews: ProposalReview[];
  /** True when the candidate is the current version of its proposal. */
  isCurrent: boolean;
}
