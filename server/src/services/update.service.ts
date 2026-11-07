import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import { IMPACT_ID_PATTERN, impactRepository } from '../repositories/impact.repository.js';
import { proposalRepository } from '../repositories/proposal.repository.js';
import { reviewRepository } from '../repositories/review.repository.js';
import { UPDATE_ID_PATTERN, updateRepository } from '../repositories/update.repository.js';
import type { AnalysisErrorCode } from '../types/analysis.types.js';
import type { ImpactResult } from '../types/impact.types.js';
import type { LearningProposal, ProposalWarning } from '../types/proposal.types.js';
import type { ProposalReview, ReviewStatus } from '../types/review.types.js';
import { UPDATE_SCHEMA_VERSION, type LearningUpdate, type LearningUpdateView, type NotUpdatedReason, type UpdateWarning } from '../types/update.types.js';
import { AIModelError } from './ai-client.js';
import { compareVersions } from './comparison.service.js';
import { catalogue } from './impact.service.js';
import { getProposal, reviewStatusFor } from './proposal.service.js';
import { recordReview } from './review.service.js';
import { resolveSource } from './source.service.js';
import { applyOperations, remapReferences, validateOutput, type ValidationContext } from './update-apply.js';
import { getUpdateModel, UPDATE_PROMPT_VERSION, type UpdateModel, type UpdateModelInput } from './update-model.js';
import { getLogicalDocument } from './version.service.js';

export interface UpdateDependencies {
  getModel: () => UpdateModel;
}
const defaultDependencies: UpdateDependencies = { getModel: getUpdateModel };
const HTTP_STATUS_FOR: Record<AnalysisErrorCode, number> = { PROVIDER_ERROR: 502, PROVIDER_TIMEOUT: 504, INVALID_RESPONSE: 502, REFUSAL: 502 };
const MAX_INPUT_CHARS = 300_000;

/** An impact result can lead to content changes only when it is a validated, supported high/medium/low assessment. */
export const isActionable = (r: ImpactResult): boolean =>
  r.origin === 'ai' && r.certainty === 'supported' && (r.impact === 'high' || r.impact === 'medium' || r.impact === 'low');

const notUpdatedReason = (r: ImpactResult): NotUpdatedReason | null =>
  r.impact === null ? 'not_assessed' : r.impact === 'no_impact' ? 'no_impact' : r.certainty === 'uncertain' ? 'uncertain' : null;

// ---------------------------------------------------------------------------------------------------------------
// Proposal versions (lineage)
// ---------------------------------------------------------------------------------------------------------------

export interface ProposalVersionEntry {
  proposalVersion: number;
  proposalId: string;
  parentProposalId: string | null;
  updateId: string | null;
  documentId: string;
  extractionId: string;
  /** Document version the proposal belongs to (null when unknown for the root). */
  documentVersion: number | null;
  reviewStatus: ReviewStatus | 'unavailable';
  isCurrent: boolean;
  title: string | null;
  createdAt: string;
}

export interface ProposalVersions {
  rootProposalId: string;
  currentProposalId: string;
  currentVersion: number;
  /** Ordered by version, then creation. Includes candidates that were not approved. */
  versions: ProposalVersionEntry[];
}

async function updatesOfRoot(rootProposalId: string): Promise<LearningUpdate[]> {
  return (await updateRepository.findAll()).filter((u) => u.rootProposalId === rootProposalId);
}

async function statusOf(proposalId: string): Promise<ReviewStatus | 'unavailable'> {
  const p = await proposalRepository.findById(proposalId);
  return p ? reviewStatusFor(p) : 'unavailable';
}

/**
 * The current version of a proposal lineage: the approved update candidate with the highest version, or the root
 * (version 1) when no update has been approved. A candidate only becomes current through human approval.
 */
async function currentOf(rootProposalId: string, updates?: LearningUpdate[]): Promise<{ proposalId: string; proposalVersion: number }> {
  let current = { proposalId: rootProposalId, proposalVersion: 1 };
  for (const u of updates ?? (await updatesOfRoot(rootProposalId))) {
    if (u.status !== 'completed' || u.proposalVersion <= current.proposalVersion) continue;
    if ((await statusOf(u.candidateProposalId!)) === 'approved') current = { proposalId: u.candidateProposalId!, proposalVersion: u.proposalVersion };
  }
  return current;
}

export async function getProposalVersions(proposalId: string): Promise<ProposalVersions> {
  const proposal = await getProposal(proposalId);
  const rootProposalId = proposal.lineage?.rootProposalId ?? proposal.proposalId;
  const root = rootProposalId === proposal.proposalId ? proposal : await proposalRepository.findById(rootProposalId);
  if (!root) throw new Error(`Root proposal ${rootProposalId} of ${proposalId} is missing`);
  const updates = (await updatesOfRoot(rootProposalId)).filter((u) => u.status === 'completed');
  const current = await currentOf(rootProposalId, updates);
  const versions: ProposalVersionEntry[] = [{
    proposalVersion: 1, proposalId: root.proposalId, parentProposalId: null, updateId: null, documentId: root.documentId, extractionId: root.extractionId,
    documentVersion: updates.find((u) => u.sourceProposalId === root.proposalId)?.from.version ?? null,
    reviewStatus: await reviewStatusFor(root), isCurrent: current.proposalId === root.proposalId, title: root.content?.title ?? null, createdAt: root.createdAt,
  }];
  for (const u of updates) {
    const candidate = await proposalRepository.findById(u.candidateProposalId!);
    versions.push({
      proposalVersion: u.proposalVersion, proposalId: u.candidateProposalId!, parentProposalId: u.sourceProposalId, updateId: u.updateId,
      documentId: u.to.documentId, extractionId: u.to.extractionId, documentVersion: u.to.version,
      reviewStatus: candidate ? await reviewStatusFor(candidate) : 'unavailable', isCurrent: current.proposalId === u.candidateProposalId,
      title: candidate?.content?.title ?? null, createdAt: u.createdAt,
    });
  }
  versions.sort((a, b) => a.proposalVersion - b.proposalVersion || a.createdAt.localeCompare(b.createdAt));
  return { rootProposalId, currentProposalId: current.proposalId, currentVersion: current.proposalVersion, versions };
}

// ---------------------------------------------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------------------------------------------

function parseRequest(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Invalid learning update request: send a JSON object.');
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (key !== 'impactAnalysisId') problems.push(`"${key}" is not an allowed field`);
  if (typeof b.impactAnalysisId !== 'string' || !IMPACT_ID_PATTERN.test(b.impactAnalysisId)) problems.push('impactAnalysisId must be an impact analysis id');
  if (problems.length > 0) throw new HttpError(400, `Invalid learning update request: ${problems.join('; ')}.`);
  return b.impactAnalysisId as string;
}

const inFlight = new Set<string>();

/**
 * Proposes, with AI, an update of the learning content affected by a completed impact analysis. The result is a
 * new candidate proposal version (separate immutable record) awaiting human review; nothing becomes current and
 * no existing proposal is modified.
 */
export async function generateLearningUpdate(projectId: string, documentId: string, body: unknown, dependencies: UpdateDependencies = defaultDependencies): Promise<LearningUpdateView> {
  const impactAnalysisId = parseRequest(body);
  await getLogicalDocument(projectId, documentId);
  const impact = await impactRepository.findById(impactAnalysisId);
  if (!impact || impact.projectId !== projectId || impact.documentId !== documentId) throw new HttpError(404, 'Impact analysis not found for this document.');
  if (impact.status !== 'completed') throw new HttpError(409, 'This impact analysis failed; it cannot be used to update learning content.');

  const parent = await proposalRepository.findById(impact.proposalId);
  if (!parent || !parent.content || parent.status !== 'draft' || parent.validationErrors.length > 0) {
    throw new HttpError(409, 'The proposal evaluated by this impact analysis is not available as learning content.');
  }
  if (parent.documentId !== impact.from.documentId || parent.extractionId !== impact.from.extractionId) {
    throw new HttpError(409, 'The evaluated proposal does not belong to the previous version of this impact analysis.');
  }
  const comparison = await compareVersions(projectId, documentId, String(impact.from.version), String(impact.to.version));
  if (comparison.comparisonId !== impact.comparisonId || comparison.from.extractionId !== impact.from.extractionId || comparison.to.extractionId !== impact.to.extractionId
    || comparison.from.documentId !== impact.from.documentId || comparison.to.documentId !== impact.to.documentId) {
    throw new HttpError(409, 'The comparison of these versions no longer matches the one used by the impact analysis.');
  }
  const changeById = new Map(comparison.changes.filter((c) => c.type !== 'unchanged').map((c) => [c.changeId, c]));
  if (impact.results.some((r) => !changeById.has(r.changeId)) || impact.results.length !== changeById.size) {
    throw new HttpError(409, 'The impact analysis results cannot be verified against the comparison.');
  }

  const rootProposalId = parent.lineage?.rootProposalId ?? parent.proposalId;
  const sourceProposalVersion = parent.lineage?.proposalVersion ?? 1;
  const current = await currentOf(rootProposalId);
  if (current.proposalId !== parent.proposalId) {
    throw new HttpError(409, `This proposal is not the current version of its learning content (the current version is ${current.proposalVersion}). Analyze the impact on the current version first.`);
  }

  const actionable = new Map(impact.results.filter(isActionable).map((r) => [r.changeId, r]));
  if (actionable.size === 0) {
    throw new HttpError(409, 'There is no learning content to update: no change has a supported high, medium or low impact (no-impact, uncertain and unassessed results are never turned into content changes).');
  }

  // -- context ----------------------------------------------------------------------------------------------------
  const { references: carried, available, stale } = remapReferences(parent, comparison);
  const rootAnalysis = await analysisRepository.findById(parent.analysisId);
  const claimText = new Map(rootAnalysis?.claims.map((c) => [c.claimId, c.text]) ?? []);
  const claimStatus = new Map(rootAnalysis?.claims.map((c) => [c.claimId, c.status]) ?? []);
  const unresolvedClaims = new Set(parent.warnings.filter((w) => w.type === 'contradiction' || w.type === 'pending_validation').flatMap((w) => w.relatedClaimIds));
  const pendingClaims = new Set([...claimStatus].filter(([, s]) => s === 'pending_validation').map(([id]) => id));
  const claimQuotes = new Map<string, string[]>();
  for (const r of carried) claimQuotes.set(r.claimId, [...(claimQuotes.get(r.claimId) ?? []), r.quote]);
  const elements = new Map(catalogue(parent).map((e) => [e.elementId, e]));
  const ctx: ValidationContext = {
    parent: parent as ValidationContext['parent'], comparison, actionable, resultIds: new Set(impact.results.map((r) => r.changeId)),
    changeById, elements, unresolvedClaims, claimQuotes, pendingClaims,
  };

  const side = (u: { sourceId: string; text: string } | undefined) => (u ? { sourceId: u.sourceId, text: u.text } : null);
  const content = parent.content;
  const input: UpdateModelInput = {
    proposal: {
      title: content.title,
      learningObjective: content.learningObjective,
      modules: content.modules.map((m) => ({
        moduleId: m.moduleId, title: m.title, learningObjective: m.learningObjective,
        lessons: m.lessons.map((l) => ({ lessonId: l.lessonId, title: l.title, content: l.content.map((c) => ({ kind: c.kind, text: c.text, claimIds: c.claimIds, requiresReview: c.requiresReview })) })),
        activities: m.activities.map((a) => ({ activityId: a.activityId, title: a.title, instructions: a.instructions, claimIds: a.claimIds })),
        assessments: m.assessments.map((a) => ({ assessmentId: a.assessmentId, type: a.type, question: a.question, options: a.options, correctAnswer: a.correctAnswer, claimIds: a.claimIds })),
      })),
    },
    claims: [...new Set(parent.sourceReferences.map((r) => r.claimId))].map((claimId) => ({
      claimId, text: claimText.get(claimId) ?? parent.sourceReferences.find((r) => r.claimId === claimId)!.quote,
      status: unresolvedClaims.has(claimId) ? 'pending_validation' : claimStatus.get(claimId) ?? 'unknown', availableInNewVersion: available.has(claimId),
    })),
    unresolvedIssues: parent.warnings.filter((w) => w.type === 'contradiction' || w.type === 'pending_validation').map((w) => ({ type: w.type, message: w.message, claimIds: w.relatedClaimIds })),
    actionableChanges: [...actionable.values()].map((r) => ({
      changeId: r.changeId, changeType: r.changeType, impact: r.impact!, justification: r.justification, reviewRecommendation: r.reviewRecommendation,
      affectedElementIds: r.affectedElements.map((e) => e.elementId), previous: side(changeById.get(r.changeId)!.from), new: side(changeById.get(r.changeId)!.to),
    })),
    otherChanges: impact.results.filter((r) => !actionable.has(r.changeId)).map((r) => ({ changeId: r.changeId, reason: notUpdatedReason(r) ?? 'no_operation' })),
  };
  if (JSON.stringify(input).length > MAX_INPUT_CHARS) throw new HttpError(422, `The proposal and the changes are too large to update in one request (limit ${MAX_INPUT_CHARS} characters).`);

  let model: UpdateModel;
  try {
    model = dependencies.getModel();
  } catch (error) {
    if (error instanceof AIModelError && error.code === 'NOT_CONFIGURED') throw new HttpError(503, error.message);
    throw error;
  }
  if (inFlight.has(impactAnalysisId)) throw new HttpError(409, 'A learning update for this impact analysis is already being generated.');
  inFlight.add(impactAnalysisId);
  try {
    return await run();
  } finally {
    inFlight.delete(impactAnalysisId);
  }

  async function run(): Promise<LearningUpdateView> {
    const updateId = randomUUID();
    const base = {
      schemaVersion: UPDATE_SCHEMA_VERSION, updateId, projectId, documentId, from: impact!.from, to: impact!.to,
      comparisonId: impact!.comparisonId, impactAnalysisId, sourceProposalId: parent!.proposalId, sourceProposalVersion, rootProposalId,
      proposalVersion: sourceProposalVersion + 1, promptVersion: UPDATE_PROMPT_VERSION, createdAt: new Date().toISOString(),
    };
    const notUpdatedBase = impact!.results.flatMap((r) => {
      const reason = notUpdatedReason(r);
      return reason ? [{ changeId: r.changeId, impact: r.impact, certainty: r.certainty, reason }] : [];
    });
    const fail = async (code: AnalysisErrorCode, message: string, cause: unknown, reportedModel: string, validationErrors: string[] = [], rejectedOperations: LearningUpdate['rejectedOperations'] = []): Promise<never> => {
      console.error(`[updates] ${updateId} failed (${code})`, cause);
      await updateRepository.create({
        ...base, candidateProposalId: null, model: reportedModel, completedAt: new Date().toISOString(), status: 'failed', operations: [], keptForReview: [],
        notUpdatedChanges: notUpdatedBase, unchangedElementIds: [], rejectedOperations, warnings: [], validationErrors, error: { code, message },
      });
      throw new HttpError(HTTP_STATUS_FOR[code], `${message} The failed attempt was recorded as learning update ${updateId}.`);
    };

    let output;
    try {
      output = await model.proposeUpdate(input);
    } catch (error) {
      const aiError = error instanceof AIModelError ? error : new AIModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
      return fail(aiError.code === 'NOT_CONFIGURED' ? 'PROVIDER_ERROR' : aiError.code, aiError.message, aiError, model.model);
    }
    const validation = validateOutput(output.data, ctx);
    if (validation.structuralErrors.length > 0 || validation.operations.length === 0) {
      const errors = validation.structuralErrors.length > 0 ? validation.structuralErrors : ['no operation passed validation'];
      return fail('INVALID_RESPONSE', `The AI provider returned a learning update that failed validation (${errors.length} problem(s)).`, errors, output.model, errors, validation.rejected);
    }

    const applied = await applyOperations({
      ctx, operations: validation.operations, keptForReview: validation.keptForReview, impactResults: impact!.results,
      carriedReferences: carried, staleClaims: stale, proposalVersion: base.proposalVersion,
    });
    const addressed = new Set(applied.operations.flatMap((o) => o.changeIds));
    const notUpdatedChanges = [
      ...notUpdatedBase,
      ...[...actionable.values()].filter((r) => !addressed.has(r.changeId)).map((r) => ({ changeId: r.changeId, impact: r.impact, certainty: r.certainty, reason: 'no_operation' as const })),
    ];
    const warnings: UpdateWarning[] = [
      ...applied.warnings,
      ...(validation.rejected.length > 0 ? [{ source: 'backend' as const, code: 'rejected_operations' as const, message: `${validation.rejected.length} AI operation(s) failed validation and were discarded; see rejectedOperations.`, elementIds: [] }] : []),
      ...validation.warnings.map((message) => ({ source: 'ai' as const, code: null, message, elementIds: [] })),
    ];

    // -- the candidate proposal version (immutable, separate record) ------------------------------------------------
    const target = await extractionRepository.findInHistory(impact!.to.documentId, impact!.to.extractionId);
    if (!target) throw new HttpError(409, 'The extraction of the new version is not available.');
    const candidateId = randomUUID();
    const proposalWarnings: ProposalWarning[] = [
      ...parent!.warnings.map(({ warningId: _id, ...w }) => w),
      ...warnings.map((w) => ({ type: 'proposal' as const, message: `Learning update ${updateId}: ${w.message}`, relatedClaimIds: [], relatedContradictionIds: [], relatedGapIds: [], requiresHumanReview: true as const })),
    ].map((w, i) => ({ warningId: `wrn_${i + 1}`, ...w }));
    const completedAt = new Date().toISOString();
    const candidate: LearningProposal = {
      schemaVersion: 1, proposalId: candidateId, analysisId: parent!.analysisId, documentId: impact!.to.documentId, extractionId: impact!.to.extractionId,
      sourceSha256: target.extraction.sourceSha256, model: output.model, promptVersion: UPDATE_PROMPT_VERSION, createdAt: base.createdAt, completedAt,
      status: 'draft', content: applied.content, sourceReferences: applied.sourceReferences, warnings: proposalWarnings, rejectedItems: [], validationErrors: [], error: null,
      lineage: { rootProposalId, parentProposalId: parent!.proposalId, proposalVersion: base.proposalVersion, updateId, impactAnalysisId },
    };
    const update: LearningUpdate = {
      ...base, candidateProposalId: candidateId, model: output.model, completedAt, status: 'completed', operations: applied.operations,
      keptForReview: applied.keptForReview, notUpdatedChanges, unchangedElementIds: applied.unchangedElementIds, rejectedOperations: validation.rejected,
      warnings, validationErrors: [], error: null,
    };
    await proposalRepository.create(candidate);
    await updateRepository.create(update);
    return { ...update, reviewStatus: 'pending_review', reviews: [], isCurrent: false };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------

async function view(update: LearningUpdate): Promise<LearningUpdateView> {
  if (!update.candidateProposalId) return { ...update, reviewStatus: null, reviews: [], isCurrent: false };
  const candidate = await proposalRepository.findById(update.candidateProposalId);
  let reviews: ProposalReview[] = [];
  let reviewStatus: LearningUpdateView['reviewStatus'] = 'unavailable';
  try {
    reviews = await reviewRepository.findByProposalId(update.candidateProposalId);
    reviewStatus = candidate ? (reviews[0]?.decision ?? 'pending_review') : 'unavailable';
  } catch (error) {
    console.error(`[updates] Review log of ${update.candidateProposalId} is unreadable`, error);
  }
  const current = await currentOf(update.rootProposalId);
  return { ...update, reviewStatus, reviews, isCurrent: current.proposalId === update.candidateProposalId };
}

export async function getLearningUpdate(updateId: string): Promise<LearningUpdateView> {
  if (!UPDATE_ID_PATTERN.test(updateId)) throw new HttpError(400, 'Malformed learning update id.');
  const update = await updateRepository.findById(updateId);
  if (!update) throw new HttpError(404, 'Learning update not found.');
  return view(update);
}

export interface LearningUpdateSummary {
  updateId: string;
  impactAnalysisId: string;
  from: LearningUpdate['from'];
  to: LearningUpdate['to'];
  sourceProposalId: string;
  sourceProposalVersion: number;
  proposalVersion: number;
  candidateProposalId: string | null;
  status: LearningUpdate['status'];
  reviewStatus: LearningUpdateView['reviewStatus'];
  isCurrent: boolean;
  model: string;
  createdAt: string;
  counts: { add: number; modify: number; remove: number; keptForReview: number; notUpdated: number; warnings: number };
  error: LearningUpdate['error'];
}

/** Updates of a logical document, newest first; optional impactAnalysisId / proposalId (source or root) filters. */
export async function listLearningUpdates(projectId: string, documentId: string, query: Record<string, unknown>): Promise<LearningUpdateSummary[]> {
  await getLogicalDocument(projectId, documentId);
  const impactId = typeof query.impactAnalysisId === 'string' ? query.impactAnalysisId : undefined;
  const proposalId = typeof query.proposalId === 'string' ? query.proposalId : undefined;
  const updates = (await updateRepository.findAll())
    .filter((u) => u.projectId === projectId && u.documentId === documentId && (!impactId || u.impactAnalysisId === impactId)
      && (!proposalId || u.sourceProposalId === proposalId || u.rootProposalId === proposalId))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.completedAt.localeCompare(x.completedAt));
  const summaries: LearningUpdateSummary[] = [];
  for (const u of updates) {
    const v = await view(u);
    const count = (op: string) => u.operations.filter((o) => o.operation === op).length;
    summaries.push({
      updateId: u.updateId, impactAnalysisId: u.impactAnalysisId, from: u.from, to: u.to, sourceProposalId: u.sourceProposalId, sourceProposalVersion: u.sourceProposalVersion,
      proposalVersion: u.proposalVersion, candidateProposalId: u.candidateProposalId, status: u.status, reviewStatus: v.reviewStatus, isCurrent: v.isCurrent,
      model: u.model, createdAt: u.createdAt,
      counts: { add: count('add'), modify: count('modify'), remove: count('remove'), keptForReview: u.keptForReview.length, notUpdated: u.notUpdatedChanges.length, warnings: u.warnings.length },
      error: u.error,
    });
  }
  return summaries;
}

// ---------------------------------------------------------------------------------------------------------------
// Review (E4.5 review log of the candidate proposal)
// ---------------------------------------------------------------------------------------------------------------

/** Re-verifies every reference of the update and of the candidate proposal against the stored extractions. */
async function referencesStillValid(update: LearningUpdate, candidate: LearningProposal): Promise<string[]> {
  const problems: string[] = [];
  const check = async (sourceId: string, test: (text: string) => boolean) => {
    try {
      if (!test((await resolveSource(sourceId)).text)) problems.push(`${sourceId} no longer matches`);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) problems.push(`${sourceId} cannot be resolved`);
      else throw error;
    }
  };
  for (const op of update.operations) for (const r of op.references) await check(r.sourceId, (t) => t === r.text);
  for (const r of candidate.sourceReferences) {
    if (!r.sourceId.startsWith(`${candidate.documentId}:${candidate.extractionId}:`)) problems.push(`${r.sourceId} is not a passage of the new version`);
    else await check(r.sourceId, (t) => t.slice(r.startOffset, r.endOffset) === r.quote);
  }
  return problems;
}

const rootQueues = new Map<string, Promise<unknown>>();
function serializeRoot<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (rootQueues.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  rootQueues.set(key, tail);
  void tail.then(() => { if (rootQueues.get(key) === tail) rootQueues.delete(key); });
  return result;
}

/**
 * Records a human decision on an update, using the E4.5 review log of its candidate proposal. Approval requires
 * the update's source proposal to still be the current version and every reference to verify; it then makes the
 * candidate the current version. Nothing is overwritten.
 */
export async function reviewLearningUpdate(projectId: string, documentId: string, updateId: string, body: unknown): Promise<ProposalReview> {
  if (!UPDATE_ID_PATTERN.test(updateId)) throw new HttpError(400, 'Malformed learning update id.');
  await getLogicalDocument(projectId, documentId);
  const update = await updateRepository.findById(updateId);
  if (!update || update.projectId !== projectId || update.documentId !== documentId) throw new HttpError(404, 'Learning update not found for this document.');
  if (update.status !== 'completed' || !update.candidateProposalId) {
    throw new HttpError(409, 'This learning update failed and has no proposed content, so it cannot be approved or rejected.');
  }
  const candidateId = update.candidateProposalId;
  return serializeRoot(update.rootProposalId, () =>
    recordReview(candidateId, body, {
      guard: async (decision) => {
        const candidate = await proposalRepository.findById(candidateId);
        if (!candidate?.lineage || candidate.lineage.updateId !== update.updateId || candidate.lineage.rootProposalId !== update.rootProposalId) {
          throw new HttpError(409, 'The proposed version does not belong to this learning update.');
        }
        if (decision === 'approved') {
          const current = await currentOf(update.rootProposalId);
          if (current.proposalId !== update.sourceProposalId) {
            throw new HttpError(409, `This update was based on version ${update.sourceProposalVersion}, but the current version is now ${current.proposalVersion}. Generate a new update from the current version.`);
          }
          const problems = await referencesStillValid(update, candidate);
          if (problems.length > 0) throw new HttpError(409, `The update cannot be approved because its references can no longer be verified: ${problems.slice(0, 5).join('; ')}.`);
        } else {
          for (const u of await updatesOfRoot(update.rootProposalId)) {
            if (u.sourceProposalId === candidateId && u.status === 'completed' && (await statusOf(u.candidateProposalId!)) === 'approved') {
              throw new HttpError(409, `A newer approved version (${u.proposalVersion}) is based on this one; it cannot be rejected now.`);
            }
          }
        }
      },
    }));
}
