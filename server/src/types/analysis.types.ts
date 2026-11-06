import type { SourceLocator } from './source.types.js';

/**
 * Information classifications.
 *   confirmed:          directly stated by the cited documentation, with verified evidence.
 *   pending_validation: relevant but ambiguous, conditional, conflicting or otherwise insufficiently supported;
 *                       requires human validation.
 *   not_documented:     relevant information the supplied documentation does not establish. It never means the
 *                       capability does not exist. Only documentation gaps carry this status.
 */
export const INFORMATION_STATUSES = ['confirmed', 'pending_validation', 'not_documented'] as const;
export type InformationStatus = (typeof INFORMATION_STATUSES)[number];

/** Statuses a claim can have. Claims always have verified evidence, so they are never not_documented. */
export const CLAIM_STATUSES = ['confirmed', 'pending_validation'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** A quotation verified by the backend against the exact stored fragment text. */
export interface ClaimEvidence {
  sourceId: string;
  locator: SourceLocator;
  /** Exact substring of the fragment text. */
  quote: string;
  /** UTF-16 code units into the fragment text; start inclusive, end exclusive: text.slice(startOffset, endOffset) === quote. */
  startOffset: number;
  endOffset: number;
}

export interface Claim {
  /** Unique within the analysis, e.g. "clm_1". */
  claimId: string;
  text: string;
  status: ClaimStatus;
  /** At least one item; every item verified. */
  evidence: ClaimEvidence[];
}

/** Why a proposed claim was not accepted (E3.2+; absent in E3.1 analyses). */
export const REJECTION_CATEGORIES = [
  'malformed', // structurally invalid item
  'missing_evidence', // no evidence supplied
  'invalid_reference', // source id malformed, from another document/extraction, or not resolvable
  'unverified_quote', // quotation not found verbatim, ambiguous or not well-formed (e.g. a paraphrase)
  'unsupported_detail', // claim introduces details (e.g. figures) absent from its evidence
  'overreach', // claim extends a capability beyond what its evidence states (automation, guarantees, no review)
] as const;
export type RejectionCategory = (typeof REJECTION_CATEGORIES)[number];

/** A claim proposed by the model that failed verification. Kept for audit; never treated as verified. */
export interface RejectedClaim {
  text: string;
  status: string;
  evidence: { sourceId: string; quote: string }[];
  reasons: string[];
  /** E3.2+: unique categories of the reasons. */
  categories?: RejectionCategory[];
}

export const CONTRADICTION_SEVERITIES = ['high', 'medium', 'low'] as const;
export type ContradictionSeverity = (typeof CONTRADICTION_SEVERITIES)[number];

/** A potential conflict between documented statements. Never resolved automatically. */
export interface Contradiction {
  /** Unique within the analysis, e.g. "ctr_1". */
  contradictionId: string;
  description: string;
  severity: ContradictionSeverity;
  /** Accepted claims involved (may be empty when the conflict is only between source passages). */
  claimIds: string[];
  /** Every side of the conflict: at least two verified, non-overlapping passages. */
  evidence: ClaimEvidence[];
  /** Always pending_review: only a human can resolve a contradiction. */
  status: 'pending_review';
}

export const GAP_CATEGORIES = [
  'limitations',
  'integrations',
  'preconditions',
  'user_responsibilities',
  'error_handling',
  'expected_outcomes',
  'other',
] as const;
export type GapCategory = (typeof GAP_CATEGORIES)[number];

/** Relevant information the documentation does not establish. Not evidence that a capability is absent. */
export interface DocumentationGap {
  /** Unique within the analysis, e.g. "gap_1". */
  gapId: string;
  /** Related feature or topic as named in the documentation. */
  topic: string;
  category: GapCategory;
  /** What information is missing. */
  description: string;
  /** Why the missing information matters. */
  relevance: string;
  status: 'not_documented';
  /** Optional verified passages that anchor the gap to the documented feature. */
  relatedEvidence: ClaimEvidence[];
}

export interface RejectedContradiction {
  description: string;
  severity: string;
  claimIndexes: number[];
  evidence: { sourceId: string; quote: string }[];
  reasons: string[];
}

export interface RejectedGap {
  topic: string;
  category: string;
  description: string;
  relevance: string;
  relatedEvidence: { sourceId: string; quote: string }[];
  reasons: string[];
}

export type AnalysisStatus = 'completed' | 'failed';
export type AnalysisErrorCode = 'PROVIDER_ERROR' | 'PROVIDER_TIMEOUT' | 'INVALID_RESPONSE' | 'REFUSAL';

/** Current analysis schema. E3.1 analyses have no `schemaVersion` (version 1) and none of the v2 fields. */
export const ANALYSIS_SCHEMA_VERSION = 2 as const;

export interface Analysis {
  /** 2 for analyses created since E3.2; absent in E3.1 analyses. */
  schemaVersion?: 2;
  analysisId: string;
  documentId: string;
  /** The exact extraction analyzed; claims and source ids always refer to it. */
  extractionId: string;
  sourceSha256: string;
  extractorVersion: string;
  /** Model reported by the provider (or the configured model when no response was received). */
  model: string;
  promptVersion: string;
  /** ISO 8601. */
  createdAt: string;
  completedAt: string;
  status: AnalysisStatus;
  claims: Claim[];
  rejectedClaims: RejectedClaim[];
  /** v2 only. */
  contradictions?: Contradiction[];
  rejectedContradictions?: RejectedContradiction[];
  documentationGaps?: DocumentationGap[];
  rejectedGaps?: RejectedGap[];
  warnings: string[];
  /** Safe, provider-neutral description of why a failed analysis failed; null when completed. */
  error: { code: AnalysisErrorCode; message: string } | null;
}
