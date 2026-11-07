import type { SourceLocator } from './source.types.js';

/**
 * E5.5: findings are the issues detected by a document analysis (contradictions, documentation gaps, pending
 * validations, analysis warnings) and by a proposal (its own warnings). Their classification is kept as detected.
 * Humans record decisions on them; a decision never modifies the documents, the analysis or any proposal.
 */
export const FINDING_TYPES = ['contradiction', 'documentation_gap', 'pending_validation', 'analysis_warning', 'proposal_warning'] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

/**
 * unresolved:             still open (the default; also visible in review indicators).
 * pending_validation:     waiting for confirmation from Product or an owner; the decision states what is missing.
 * resolved_with_evidence: resolved by a human, with an explanation and a verified passage of the documentation.
 */
export const FINDING_STATUSES = ['unresolved', 'pending_validation', 'resolved_with_evidence'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

/** A verified passage of authorized documentation cited by a human decision. */
export interface DecisionEvidence {
  sourceId: string;
  locator: SourceLocator;
  /** Exact text found in the source fragment. */
  quote: string;
}

/** One immutable human decision: <findingDecisionsDir>/<analysisId>/<decisionId>.json. */
export interface FindingDecision {
  schemaVersion: 1;
  decisionId: string;
  analysisId: string;
  findingId: string;
  status: FindingStatus;
  /** How it was resolved / why it stays open. Required for resolved_with_evidence. */
  explanation: string | null;
  /** What information is missing or which question must be answered. Required for pending_validation. */
  question: string | null;
  /** Required for resolved_with_evidence; null otherwise. */
  evidence: DecisionEvidence | null;
  /** The previous decision on the same finding (null for the first): a chain per finding. */
  previousDecisionId: string | null;
  decidedAt: string;
}

export const FINDING_TEXT_LIMIT = 2_000;
