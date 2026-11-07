import type { AnalysisErrorCode } from './analysis.types.js';
import type { ContentItem, Module, ProposalAttribute, ProposalWarning, RejectedItem, SourceReference } from './proposal.types.js';

/**
 * E5.5: audience trainings. Every approved proposal (root or approved update candidate) produces one training per
 * audience, generated from the proposal's content only. Trainings are immutable records awaiting human review.
 */
export const AUDIENCES = ['sales', 'customer_experience'] as const;
export type Audience = (typeof AUDIENCES)[number];

/** A reusable, product-independent competency of an audience profile. */
export interface ProfileCompetency {
  /** Stable id, e.g. "sales.discovery". */
  competencyId: string;
  name: string;
  description: string;
}

export interface CompetencyProfile {
  audience: Audience;
  label: string;
  /** What the audience does with a product, in general terms. */
  purpose: string;
  competencies: ProfileCompetency[];
}

/** A profile competency the AI judged relevant for this product, with the claims that make it relevant. */
export interface SelectedCompetency {
  competencyId: string;
  name: string;
  /** Why it matters for this product (pedagogical, not a product fact). */
  rationale: string;
  claimIds: string[];
}

/** A profile competency left out because the documentation gives it no basis for this product. */
export interface ExcludedCompetency {
  competencyId: string;
  reason: string;
}

export interface TrainingLineage {
  rootProposalId: string;
  /** Version of the source proposal (1 = root, 2+ = approved update candidates). */
  proposalVersion: number;
  /** 1, 2, ... per audience within the root proposal's lineage (successful generations only). */
  trainingVersion: number;
  /** The previous training of the same audience in the lineage (null for the first). */
  previousTrainingId: string | null;
}

export type TrainingStatus = 'draft' | 'failed';

export interface TrainingContent {
  title: string;
  learningObjective: string;
  prerequisites: ProposalAttribute;
  estimatedDuration: ProposalAttribute;
  competencies: SelectedCompetency[];
  excludedCompetencies: ExcludedCompetency[];
  /** What the learner will be able to do (pedagogical statements). */
  learningOutcomes: string[];
  /** Product knowledge the audience needs; same evidence rules as lesson content. */
  productKnowledge: ContentItem[];
  modules: Module[];
}

export interface AudienceTraining {
  schemaVersion: 1;
  trainingId: string;
  audience: Audience;
  /** The approved proposal (version) this training was generated from. */
  proposalId: string;
  analysisId: string;
  documentId: string;
  extractionId: string;
  sourceSha256: string;
  profileVersion: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string;
  status: TrainingStatus;
  lineage: TrainingLineage;
  /** null for failed attempts. */
  content: TrainingContent | null;
  sourceReferences: SourceReference[];
  warnings: ProposalWarning[];
  rejectedItems: RejectedItem[];
  validationErrors: string[];
  error: { code: AnalysisErrorCode; message: string } | null;
}

export const TRAINING_SCHEMA_VERSION = 1 as const;
