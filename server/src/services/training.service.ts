import { randomUUID } from 'node:crypto';
import { AUDIENCE_LABELS, COMPETENCY_PROFILES, PROFILE_VERSION } from '../config/competency-profiles.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.middleware.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { PROPOSAL_ID_PATTERN, proposalRepository } from '../repositories/proposal.repository.js';
import { trainingReviewRepository } from '../repositories/review.repository.js';
import { TRAINING_ID_PATTERN, trainingRepository } from '../repositories/training.repository.js';
import type { AnalysisErrorCode, Claim } from '../types/analysis.types.js';
import type { LearningProposal, ProposalWarning, SourceReference } from '../types/proposal.types.js';
import type { ProposalReview, ReviewStatus } from '../types/review.types.js';
import { AUDIENCES, TRAINING_SCHEMA_VERSION, type Audience, type AudienceTraining } from '../types/training.types.js';
import { AIModelError } from './ai-client.js';
import { assemble, reviewStatusFor, warning } from './proposal.service.js';
import type { ClaimContext, ValidatedProposal, ValidationContext } from './proposal-validation.js';
import { parseDecision, pendingValidationItemCount, recordDecision } from './review.service.js';
import { resolveSource } from './source.service.js';
import { getTrainingModel, profileForModel, TRAINING_PROMPT_VERSION, type TrainingModel, type TrainingModelInput } from './training-model.js';
import { validateTraining } from './training-validation.js';

/**
 * E5.5: audience trainings. Each approved proposal version produces one Sales and one Customer Experience training,
 * generated independently (a failure of one never affects the other), stored as immutable records and reviewed by a
 * human. Nothing is approved or published automatically, and an existing training is never overwritten: a new
 * generation for an audience is only allowed when it has no training yet, its last attempt failed, or a human
 * rejected its training.
 */

export interface TrainingDependencies {
  getModel: () => TrainingModel;
}
const defaultDependencies: TrainingDependencies = { getModel: getTrainingModel };
const CARRIED_WARNINGS = new Set(['contradiction', 'documentation_gap', 'pending_validation', 'analysis_warning']);

// ---------------------------------------------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------------------------------------------

export interface TrainingSummary {
  trainingId: string;
  audience: Audience;
  proposalId: string;
  proposalVersion: number;
  trainingVersion: number;
  previousTrainingId: string | null;
  status: AudienceTraining['status'];
  reviewStatus: ReviewStatus | 'unavailable';
  title: string | null;
  learningObjective: string | null;
  model: string;
  createdAt: string;
  counts: { competencies: number; modules: number; lessons: number; activities: number; assessments: number; warnings: number; pendingItems: number; requiresReview: number; rejectedItems: number };
  error: AudienceTraining['error'];
}

export type GenerationState = 'not_generated' | 'generating' | 'generated' | 'failed';

export interface AudienceTrainingState {
  audience: Audience;
  label: string;
  state: GenerationState;
  /** The newest successfully generated training for this proposal (null if none). */
  current: TrainingSummary | null;
  /** The newest attempt (may be a failed one after `current`). */
  lastAttempt: TrainingSummary | null;
  /** Every attempt for this proposal, newest first. */
  attempts: TrainingSummary[];
  /** True when a (re)generation is allowed now. */
  canGenerate: boolean;
}

export interface ProposalTrainings {
  proposalId: string;
  proposalVersion: number;
  proposalReviewStatus: ReviewStatus | 'unavailable';
  aiConfigured: boolean;
  audiences: AudienceTrainingState[];
}

const inFlight = new Set<string>();
const flightKey = (proposalId: string, audience: Audience) => `${proposalId}:${audience}`;
/** Requested generations not started yet (marked synchronously on request, so the state never shows a gap). */
const requestedRuns = new Map<string, number>();
const markRequested = (proposalId: string, audiences: Audience[], delta: number) => {
  for (const a of audiences) {
    const key = flightKey(proposalId, a);
    const n = (requestedRuns.get(key) ?? 0) + delta;
    if (n > 0) requestedRuns.set(key, n); else requestedRuns.delete(key);
  }
};
/** Generations of one proposal run one after another, so concurrent requests never duplicate a training. */
const proposalQueues = new Map<string, Promise<unknown>>();
function serializeProposal<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (proposalQueues.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  proposalQueues.set(key, tail);
  void tail.then(() => { if (proposalQueues.get(key) === tail) proposalQueues.delete(key); });
  return result;
}

export async function trainingReviewStatus(t: AudienceTraining): Promise<ReviewStatus | 'unavailable'> {
  if (t.status !== 'draft' || t.validationErrors.length > 0) return 'not_reviewable';
  try {
    return (await trainingReviewRepository.findByProposalId(t.trainingId))[0]?.decision ?? 'pending_review';
  } catch (error) {
    console.error(`[trainings] Review log of training ${t.trainingId} is unreadable`, error);
    return 'unavailable';
  }
}

export async function summarizeTraining(t: AudienceTraining): Promise<TrainingSummary> {
  const modules = t.content?.modules ?? [];
  const items = [...modules.flatMap((m) => m.lessons.flatMap((l) => l.content)), ...(t.content?.productKnowledge ?? [])];
  return {
    trainingId: t.trainingId, audience: t.audience, proposalId: t.proposalId, proposalVersion: t.lineage.proposalVersion, trainingVersion: t.lineage.trainingVersion,
    previousTrainingId: t.lineage.previousTrainingId, status: t.status, reviewStatus: await trainingReviewStatus(t), title: t.content?.title ?? null,
    learningObjective: t.content?.learningObjective ?? null, model: t.model, createdAt: t.createdAt,
    counts: {
      competencies: t.content?.competencies.length ?? 0,
      modules: modules.length,
      lessons: modules.reduce((n, m) => n + m.lessons.length, 0),
      activities: modules.reduce((n, m) => n + m.activities.length, 0),
      assessments: modules.reduce((n, m) => n + m.assessments.length, 0),
      warnings: t.warnings.length,
      pendingItems: items.filter((c) => c.kind === 'pending_validation').length,
      requiresReview: items.filter((c) => c.requiresReview).length + modules.reduce((n, m) => n + m.activities.filter((a) => a.requiresReview).length + m.assessments.filter((a) => a.requiresReview).length, 0),
      rejectedItems: t.rejectedItems.length,
    },
    error: t.error,
  };
}

async function loadProposal(proposalId: string): Promise<LearningProposal> {
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) throw new HttpError(400, 'Malformed proposal id.');
  const proposal = await proposalRepository.findById(proposalId);
  if (!proposal) throw new HttpError(404, 'Proposal not found.');
  return proposal;
}

const newestFirst = (a: AudienceTraining, b: AudienceTraining) => b.createdAt.localeCompare(a.createdAt) || b.completedAt.localeCompare(a.completedAt);

export async function getProposalTrainings(proposalId: string, options: { ignoreRequested?: boolean } = {}): Promise<ProposalTrainings> {
  const proposal = await loadProposal(proposalId);
  const reviewStatus = await reviewStatusFor(proposal);
  const all = (await trainingRepository.findAll()).filter((t) => t.proposalId === proposalId).sort(newestFirst);
  const audiences: AudienceTrainingState[] = [];
  for (const audience of AUDIENCES) {
    const attempts = await Promise.all(all.filter((t) => t.audience === audience).map(summarizeTraining));
    const current = attempts.find((a) => a.status === 'draft') ?? null;
    const eligible = reviewStatus === 'approved' && (!current || current.reviewStatus === 'rejected');
    const key = flightKey(proposalId, audience);
    const generating = inFlight.has(key) || (!options.ignoreRequested && eligible && requestedRuns.has(key));
    const state: GenerationState = generating ? 'generating' : current ? 'generated' : attempts.length > 0 ? 'failed' : 'not_generated';
    audiences.push({
      audience, label: AUDIENCE_LABELS[audience], state, current, lastAttempt: attempts[0] ?? null, attempts,
      canGenerate: eligible && !generating,
    });
  }
  return { proposalId, proposalVersion: proposal.lineage?.proposalVersion ?? 1, proposalReviewStatus: reviewStatus, aiConfigured: Boolean(env.openai.apiKey), audiences };
}

// ---------------------------------------------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------------------------------------------

function parseRequest(body: unknown): Audience[] | null {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid training request: send a JSON object.');
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (key !== 'audiences') problems.push(`"${key}" is not an allowed field`);
  if (b.audiences !== undefined && (!Array.isArray(b.audiences) || b.audiences.length === 0 || !b.audiences.every((a) => AUDIENCES.includes(a as Audience)))) {
    problems.push(`audiences must be a non-empty list of: ${AUDIENCES.join(', ')}`);
  }
  if (problems.length > 0) throw new HttpError(400, `Invalid training request: ${problems.join('; ')}.`);
  return b.audiences === undefined ? null : [...new Set(b.audiences as Audience[])];
}

/** The proposal's claims as trusted context: its verified references, re-verified against the stored extractions. */
async function claimContext(proposal: LearningProposal) {
  const analysis = await analysisRepository.findById(proposal.analysisId);
  const analysisClaims = new Map((analysis?.claims ?? []).map((c) => [c.claimId, c]));
  const references = new Map<string, SourceReference[]>();
  const problems: string[] = [];
  for (const r of proposal.sourceReferences) {
    let ok = false;
    try {
      ok = (await resolveSource(r.sourceId)).text.slice(r.startOffset, r.endOffset) === r.quote;
    } catch (error) {
      if (!(error instanceof HttpError && error.status < 500)) throw error;
    }
    if (ok) references.set(r.claimId, [...(references.get(r.claimId) ?? []), r]);
    else problems.push(r.claimId);
  }
  const unverified = [...new Set(problems)].filter((id) => !references.has(id));
  const claims: Claim[] = [...references].map(([claimId, refs]) => ({
    claimId,
    text: analysisClaims.get(claimId)?.text ?? refs[0]!.quote,
    // Claims introduced by learning updates (src_v*) quote the documentation directly; others keep the analysis status.
    status: analysisClaims.get(claimId)?.status ?? 'confirmed',
    evidence: refs.map(({ sourceId, locator, quote, startOffset, endOffset }) => ({ sourceId, locator, quote, startOffset, endOffset })),
  }));
  const issues = proposal.warnings.filter((w) => CARRIED_WARNINGS.has(w.type));
  const claimsUnderReview = new Set(issues.filter((w) => w.type === 'contradiction' || w.type === 'pending_validation').flatMap((w) => w.relatedClaimIds));
  const ctx: ValidationContext = {
    claims: new Map<string, ClaimContext>(claims.map((c) => [c.claimId, { claimId: c.claimId, status: c.status, quotes: c.evidence.map((e) => e.quote) }])),
    contradictionIds: new Set([...(analysis?.contradictions ?? []).map((c) => c.contradictionId), ...issues.flatMap((w) => w.relatedContradictionIds)]),
    gapIds: new Set([...(analysis?.documentationGaps ?? []).map((g) => g.gapId), ...issues.flatMap((w) => w.relatedGapIds)]),
    claimsUnderReview,
  };
  return { claims, ctx, issues, unverified };
}

/**
 * Generates the missing trainings of an approved proposal (all audiences by default). Audiences are generated in
 * parallel and independently; each result (draft or failed attempt) is stored on its own. Audiences that already
 * have a training (not rejected) or are being generated are skipped, so nothing is duplicated or overwritten.
 */
export function generateTrainings(proposalId: string, body: unknown, dependencies: TrainingDependencies = defaultDependencies): Promise<ProposalTrainings> {
  let requested: Audience[] | null;
  try {
    requested = parseRequest(body);
  } catch (error) {
    return Promise.reject(error);
  }
  const marked = PROPOSAL_ID_PATTERN.test(proposalId) ? requested ?? [...AUDIENCES] : [];
  markRequested(proposalId, marked, 1);
  return serializeProposal(proposalId, () => runGeneration(proposalId, requested, dependencies))
    .finally(() => markRequested(proposalId, marked, -1))
    .then(() => getProposalTrainings(proposalId));
}

async function runGeneration(proposalId: string, requested: Audience[] | null, dependencies: TrainingDependencies): Promise<void> {
  const proposal = await loadProposal(proposalId);
  if (!proposal.content || proposal.status !== 'draft') throw new HttpError(409, 'This proposal has no learning content.');
  if ((await reviewStatusFor(proposal)) !== 'approved') throw new HttpError(409, 'Trainings are generated only from an approved proposal. Approve the proposal first.');

  const before = await getProposalTrainings(proposalId, { ignoreRequested: true });
  const targets = before.audiences.filter((a) => a.canGenerate && (!requested || requested.includes(a.audience))).map((a) => a.audience);
  if (targets.length === 0) return;

  let model: TrainingModel;
  try {
    model = dependencies.getModel();
  } catch (error) {
    if (error instanceof AIModelError && error.code === 'NOT_CONFIGURED') throw new HttpError(503, error.message);
    throw error;
  }
  const context = await claimContext(proposal);
  if (![...context.ctx.claims.values()].some((c) => c.status === 'confirmed')) {
    throw new HttpError(409, 'The proposal has no confirmed claims whose evidence can still be verified, so no training can be generated.');
  }
  const keys = targets.map((a) => flightKey(proposalId, a));
  keys.forEach((k) => inFlight.add(k));
  try {
    const results = await Promise.allSettled(targets.map((a) => generateOne(proposal, a, context, model)));
    for (const r of results) if (r.status === 'rejected') console.error('[trainings] Unexpected generation error', r.reason);
  } finally {
    keys.forEach((k) => inFlight.delete(k));
  }
}

/** Fire-and-forget generation after an approval (E5.5 "automatic"). Never throws; skipped when AI is not configured. */
export function generateTrainingsInBackground(proposalId: string): void {
  if (!env.openai.apiKey) return;
  void generateTrainings(proposalId, {}).catch((error: unknown) => {
    if (!(error instanceof HttpError && error.status < 500)) console.error(`[trainings] Background generation for proposal ${proposalId} failed`, error);
  });
}

async function generateOne(proposal: LearningProposal, audience: Audience, context: Awaited<ReturnType<typeof claimContext>>, model: TrainingModel): Promise<AudienceTraining> {
  const profile = COMPETENCY_PROFILES[audience];
  const rootProposalId = proposal.lineage?.rootProposalId ?? proposal.proposalId;
  const lineageTrainings = (await trainingRepository.findAll())
    .filter((t) => t.audience === audience && t.lineage.rootProposalId === rootProposalId && t.status === 'draft').sort(newestFirst);
  const previous = lineageTrainings[0] ?? null;
  const trainingId = randomUUID();
  const base = {
    schemaVersion: TRAINING_SCHEMA_VERSION, trainingId, audience, proposalId: proposal.proposalId, analysisId: proposal.analysisId,
    documentId: proposal.documentId, extractionId: proposal.extractionId, sourceSha256: proposal.sourceSha256, profileVersion: PROFILE_VERSION,
    promptVersion: TRAINING_PROMPT_VERSION, createdAt: new Date().toISOString(),
    lineage: { rootProposalId, proposalVersion: proposal.lineage?.proposalVersion ?? 1, trainingVersion: lineageTrainings.length + 1, previousTrainingId: previous?.trainingId ?? null },
  };
  const fail = async (code: AnalysisErrorCode, message: string, cause: unknown, reportedModel: string, validationErrors: string[] = []): Promise<AudienceTraining> => {
    console.error(`[trainings] ${trainingId} (${audience}) for proposal ${proposal.proposalId} failed (${code})`, cause);
    const failed: AudienceTraining = {
      ...base, lineage: { ...base.lineage, trainingVersion: 0 }, model: reportedModel, completedAt: new Date().toISOString(), status: 'failed', content: null,
      sourceReferences: [], warnings: [], rejectedItems: [], validationErrors, error: { code, message },
    };
    await trainingRepository.create(failed);
    return failed;
  };

  const content = proposal.content!;
  const input: TrainingModelInput = {
    audience: { label: profile.label, purpose: profile.purpose },
    competencyProfile: profileForModel(profile),
    approvedProposal: {
      title: content.title,
      learningObjective: content.learningObjective,
      modules: content.modules.map((m) => ({
        title: m.title, learningObjective: m.learningObjective,
        lessons: m.lessons.map((l) => ({ title: l.title, content: l.content.filter((c) => c.claimIds.every((id) => context.ctx.claims.has(id))).map(({ kind, text, claimIds }) => ({ kind, text, claimIds })) })),
      })),
    },
    claims: context.claims.map((c) => ({ claimId: c.claimId, text: c.text, status: c.status, quotes: c.evidence.map((e) => e.quote) })),
    openIssues: context.issues.map((w) => ({ type: w.type, message: w.message, claimIds: w.relatedClaimIds, contradictionIds: w.relatedContradictionIds, gapIds: w.relatedGapIds })),
    previousTraining: previous?.content
      ? { title: previous.content.title, learningObjective: previous.content.learningObjective, competencyIds: previous.content.competencies.map((c) => c.competencyId), moduleTitles: previous.content.modules.map((m) => m.title) }
      : null,
  };

  let output;
  try {
    output = await model.generateTraining(input);
  } catch (error) {
    const aiError = error instanceof AIModelError ? error : new AIModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
    return fail(aiError.code === 'NOT_CONFIGURED' ? 'PROVIDER_ERROR' : aiError.code, aiError.message, aiError, model.model);
  }
  const validation = validateTraining(output.data, context.ctx, profile);
  if (!validation.training) {
    return fail('INVALID_RESPONSE', `The AI provider returned a ${profile.label} training that failed validation (${validation.errors.length} problem(s)).`, validation.errors, output.model, validation.errors);
  }

  // -- assemble with the E3.3 proposal assembler (backend ids, backend-derived evidence, merged warnings) ---------------
  const backendWarnings = [
    ...context.issues.map(({ warningId: _id, ...w }) => w),
    ...context.unverified.map((id) => warning('analysis_warning', `${id} was excluded: its evidence could not be re-verified against the documentation.`, { relatedClaimIds: [id] })),
  ];
  const v = validation.training;
  const validated: ValidatedProposal = { ...v, audience: { value: profile.label, status: 'pending_validation', claimIds: [] } };
  const assembled = assemble({
    schemaVersion: 1, proposalId: proposal.proposalId, analysisId: base.analysisId, documentId: base.documentId, extractionId: base.extractionId,
    sourceSha256: base.sourceSha256, promptVersion: base.promptVersion, createdAt: base.createdAt,
  }, output.model, validated, context.claims, backendWarnings, validation.rejectedItems, validation.notes);
  const usedClaims = new Set([
    ...v.prerequisites.claimIds, ...v.estimatedDuration.claimIds, ...v.competencies.flatMap((c) => c.claimIds), ...v.productKnowledge.flatMap((c) => c.claimIds),
    ...assembled.content!.modules.flatMap((m) => m.claimIds),
  ]);
  const byClaim = new Map(context.claims.map((c) => [c.claimId, c]));
  const sourceReferences = [...usedClaims].flatMap((id) => (byClaim.get(id)?.evidence ?? []).map((e) => ({ claimId: id, ...e })));
  const training: AudienceTraining = {
    ...base, model: output.model, completedAt: new Date().toISOString(), status: 'draft',
    content: {
      title: v.title, learningObjective: v.learningObjective, prerequisites: v.prerequisites, estimatedDuration: v.estimatedDuration,
      competencies: v.competencies, excludedCompetencies: v.excludedCompetencies, learningOutcomes: v.learningOutcomes, productKnowledge: v.productKnowledge,
      modules: assembled.content!.modules,
    },
    sourceReferences, warnings: assembled.warnings as ProposalWarning[], rejectedItems: assembled.rejectedItems, validationErrors: [], error: null,
  };
  await trainingRepository.create(training);
  return training;
}

// ---------------------------------------------------------------------------------------------------------------
// Read and review
// ---------------------------------------------------------------------------------------------------------------

export interface TrainingView extends AudienceTraining {
  audienceLabel: string;
  reviewStatus: ReviewStatus | 'unavailable';
  proposalTitle: string | null;
  proposalReviewStatus: ReviewStatus | 'unavailable';
}

export async function loadTraining(trainingId: string): Promise<AudienceTraining> {
  if (!TRAINING_ID_PATTERN.test(trainingId)) throw new HttpError(400, 'Malformed training id.');
  const training = await trainingRepository.findById(trainingId);
  if (!training) throw new HttpError(404, 'Training not found.');
  return training;
}

export async function getTraining(trainingId: string): Promise<TrainingView> {
  const training = await loadTraining(trainingId);
  const proposal = await proposalRepository.findById(training.proposalId);
  return {
    ...training, audienceLabel: AUDIENCE_LABELS[training.audience], reviewStatus: await trainingReviewStatus(training),
    proposalTitle: proposal?.content?.title ?? null, proposalReviewStatus: proposal ? await reviewStatusFor(proposal) : 'unavailable',
  };
}

export async function getTrainingReviewLog(trainingId: string): Promise<{ proposalId: string; trainingId: string; reviewStatus: ReviewStatus; reviews: ProposalReview[] }> {
  const training = await loadTraining(trainingId);
  const reviews = await trainingReviewRepository.findByProposalId(trainingId);
  const reviewStatus: ReviewStatus = training.status !== 'draft' || training.validationErrors.length > 0 ? 'not_reviewable' : reviews[0]?.decision ?? 'pending_review';
  // proposalId mirrors the E4.5 review log shape; for trainings it is the training id the log belongs to.
  return { proposalId: trainingId, trainingId, reviewStatus, reviews };
}

/** Human decision on a training (E4.5 rules). Approval requires its source proposal to still be approved. */
export async function recordTrainingReview(trainingId: string, body: unknown): Promise<ProposalReview> {
  const input = parseDecision(body);
  const training = await loadTraining(trainingId);
  return recordDecision(input, {
    key: trainingId,
    repository: trainingReviewRepository,
    reviewable: training.status === 'draft' && training.validationErrors.length === 0,
    subject: 'training',
    warningCount: training.warnings.length,
    pendingCount: pendingValidationItemCount(training) + (training.content?.productKnowledge.filter((c) => c.kind === 'pending_validation').length ?? 0),
    fields: { proposalId: training.proposalId, trainingId, analysisId: training.analysisId, documentId: training.documentId },
  }, {
    guard: async (decision) => {
      if (decision !== 'approved') return;
      const proposal = await proposalRepository.findById(training.proposalId);
      if (!proposal || (await reviewStatusFor(proposal)) !== 'approved') {
        throw new HttpError(409, 'The proposal this training was generated from is no longer approved, so the training cannot be approved.');
      }
    },
  });
}
