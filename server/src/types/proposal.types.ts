import type { AnalysisErrorCode } from './analysis.types.js';
import type { SourceLocator } from './source.types.js';

/**
 * supported:          established by confirmed claims (listed in claimIds).
 * pending_validation: not established by the documentation (e.g. an estimate or an assumption); a human must
 *                     validate it.
 */
export type AttributeStatus = 'supported' | 'pending_validation';

/** A proposal attribute such as the audience or the duration, with an explicit evidence status. */
export interface ProposalAttribute {
  value: string;
  status: AttributeStatus;
  claimIds: string[];
}

/**
 * fact:               a factual product statement; references confirmed claims only.
 * guidance:           pedagogical text (introductions, transitions, study tips) without product behavior.
 * pending_validation: information from pending-validation claims, explicitly flagged for human review.
 */
export const CONTENT_KINDS = ['fact', 'guidance', 'pending_validation'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export interface ContentItem {
  kind: ContentKind;
  text: string;
  claimIds: string[];
  requiresReview: boolean;
}

export interface Lesson {
  lessonId: string;
  order: number;
  title: string;
  content: ContentItem[];
}

export interface Activity {
  activityId: string;
  title: string;
  instructions: string;
  claimIds: string[];
  requiresReview: boolean;
}

export const ASSESSMENT_TYPES = ['multiple_choice', 'true_false', 'open_question', 'exercise'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

export interface Assessment {
  assessmentId: string;
  type: AssessmentType;
  question: string;
  /** Answer options for multiple_choice / true_false; empty otherwise. */
  options: string[];
  /** The correct option, or the expected answer for open questions and exercises. */
  correctAnswer: string;
  claimIds: string[];
  requiresReview: boolean;
}

/** A verified source passage behind a claim, copied from the source analysis. */
export interface SourceReference {
  claimId: string;
  sourceId: string;
  locator: SourceLocator;
  quote: string;
  startOffset: number;
  endOffset: number;
}

export interface Module {
  moduleId: string;
  order: number;
  title: string;
  learningObjective: string;
  suggestedDuration: ProposalAttribute;
  lessons: Lesson[];
  activities: Activity[];
  assessments: Assessment[];
  /** Claims used anywhere in the module (computed by the backend). */
  claimIds: string[];
  /** Verified passages behind those claims (computed by the backend). */
  evidence: SourceReference[];
}

export const WARNING_TYPES = ['contradiction', 'documentation_gap', 'pending_validation', 'analysis_warning', 'proposal'] as const;
export type WarningType = (typeof WARNING_TYPES)[number];

export interface ProposalWarning {
  warningId: string;
  type: WarningType;
  message: string;
  relatedClaimIds: string[];
  relatedContradictionIds: string[];
  relatedGapIds: string[];
  /** Always true: warnings are unresolved issues for the reviewer. */
  requiresHumanReview: true;
}

/** Generated content removed by validation, kept for audit. */
export interface RejectedItem {
  /** e.g. "modules[0].lessons[1].content[2]". */
  location: string;
  kind: string;
  text: string;
  reasons: string[];
}

/**
 * draft:  a validated proposal awaiting human review. The only status a generated proposal ever has.
 * failed: a generation attempt that produced no valid proposal (kept for audit; contains no learning content).
 */
export type ProposalStatus = 'draft' | 'failed';

export const PROPOSAL_SCHEMA_VERSION = 1 as const;

export interface LearningProposal {
  schemaVersion: 1;
  proposalId: string;
  analysisId: string;
  documentId: string;
  extractionId: string;
  sourceSha256: string;
  model: string;
  promptVersion: string;
  /** ISO 8601. */
  createdAt: string;
  completedAt: string;
  status: ProposalStatus;
  /** Learning content; null for failed attempts. */
  content: {
    title: string;
    learningObjective: string;
    audience: ProposalAttribute;
    prerequisites: ProposalAttribute;
    estimatedDuration: ProposalAttribute;
    modules: Module[];
  } | null;
  /** All verified passages behind every claim the proposal uses. */
  sourceReferences: SourceReference[];
  warnings: ProposalWarning[];
  rejectedItems: RejectedItem[];
  /** Validation problems that made a generation attempt fail; empty for drafts. */
  validationErrors: string[];
  error: { code: AnalysisErrorCode; message: string } | null;
}
