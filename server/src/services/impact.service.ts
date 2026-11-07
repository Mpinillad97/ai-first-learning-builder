import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { analysisRepository } from '../repositories/analysis.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import { IMPACT_ID_PATTERN, impactRepository } from '../repositories/impact.repository.js';
import { PROPOSAL_ID_PATTERN, proposalRepository } from '../repositories/proposal.repository.js';
import { reviewRepository } from '../repositories/review.repository.js';
import type { AnalysisErrorCode } from '../types/analysis.types.js';
import {
  IMPACT_CERTAINTIES,
  IMPACT_LEVELS,
  IMPACT_SCHEMA_VERSION,
  type AffectedElementSummary,
  type ImpactAnalysis,
  type ImpactCertainty,
  type ImpactElementRef,
  type ImpactEvidence,
  type ImpactLevel,
  type ImpactResult,
  type ImpactReviewReason,
  type ImpactWarning,
  type ImpactWarningCode,
  type LearningElementType,
  type RejectedImpactResult,
} from '../types/impact.types.js';
import type { LearningProposal } from '../types/proposal.types.js';
import type { ReviewStatus } from '../types/review.types.js';
import type { ComparedUnit, DocumentChange, DocumentComparison } from '../types/version.types.js';
import { AIModelError } from './ai-client.js';
import { listDocumentAnalyses } from './analysis.service.js';
import { compareVersions } from './comparison.service.js';
import { getImpactModel, IMPACT_PROMPT_VERSION, type ImpactModel, type ImpactModelInput } from './impact-model.js';
import { listAnalysisProposals, reviewStatusFor, summarizeProposal, type ProposalSummary } from './proposal.service.js';
import { updateRepository } from '../repositories/update.repository.js';
import { reviewStatusOf } from './review.service.js';
import { parseSourceId, resolveSource } from './source.service.js';
import { getLogicalDocument, getVersion } from './version.service.js';

export interface ImpactDependencies {
  getModel: () => ImpactModel;
}
const defaultDependencies: ImpactDependencies = { getModel: getImpactModel };

const HTTP_STATUS_FOR: Record<AnalysisErrorCode, number> = { PROVIDER_ERROR: 502, PROVIDER_TIMEOUT: 504, INVALID_RESPONSE: 502, REFUSAL: 502 };
const MAX_INPUT_CHARS = 300_000;
const MAX_TEXT = { justification: 2_000, reviewRecommendation: 1_000, warning: 1_000 };
const RANK: Record<ImpactLevel, number> = { high: 3, medium: 2, low: 1, no_impact: 0 };

// ---------------------------------------------------------------------------------------------------------------
// Compatible proposals
// ---------------------------------------------------------------------------------------------------------------

export interface CompatibleProposals {
  version: number;
  documentId: string;
  /** The version's current extraction; null when the version has no citable extraction (then no proposal fits). */
  extractionId: string | null;
  /** Draft proposals generated from exactly this extraction, newest first, with their review status. */
  proposals: ProposalSummary[];
}

/** Proposals that can be evaluated against changes from this version: same document and same extraction. */
export async function listCompatibleProposals(projectId: string, documentId: string, rawVersion: string): Promise<CompatibleProposals> {
  const v = await getVersion(projectId, documentId, rawVersion);
  const extraction = v.status === 'processed' ? await extractionRepository.findCurrent(v.documentId) : null;
  const extractionId = extraction?.extractionId ?? null;
  if (!extractionId) return { version: v.version, documentId: v.documentId, extractionId: null, proposals: [] };
  const proposals: ProposalSummary[] = [];
  for (const analysis of await listDocumentAnalyses(v.documentId)) {
    if (analysis.extractionId !== extractionId || analysis.status !== 'completed') continue;
    for (const p of await listAnalysisProposals(analysis.analysisId)) {
      if (p.status === 'draft' && p.extractionId === extractionId && p.counts.validationErrors === 0) proposals.push(p);
    }
  }
  // E5.3: proposal versions produced by learning updates for this version, once a human approved them.
  for (const u of await updateRepository.findAll()) {
    if (u.status !== 'completed' || u.to.documentId !== v.documentId || u.to.extractionId !== extractionId) continue;
    const p = await proposalRepository.findById(u.candidateProposalId!);
    if (!p) continue;
    const status = await reviewStatusFor(p);
    if (status === 'approved') proposals.push(summarizeProposal(p, status));
  }
  proposals.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  return { version: v.version, documentId: v.documentId, extractionId, proposals };
}

// ---------------------------------------------------------------------------------------------------------------
// Learning elements of a proposal
// ---------------------------------------------------------------------------------------------------------------

export interface Element extends ImpactElementRef {
  text: string;
  claimIds: string[];
  requiresReview: boolean;
}

/** Every learning element of a proposal (modules, lessons, activities, assessments) with its claims. */
export function catalogue(proposal: LearningProposal): Element[] {
  const elements: Element[] = [];
  for (const m of proposal.content?.modules ?? []) {
    const ref = (elementId: string, elementType: LearningElementType, title: string) => ({ elementId, elementType, moduleId: m.moduleId, title });
    elements.push({ ...ref(m.moduleId, 'module', m.title), text: m.learningObjective, claimIds: m.claimIds, requiresReview: false });
    for (const l of m.lessons) {
      elements.push({
        ...ref(l.lessonId, 'lesson', l.title),
        text: l.content.map((c) => `[${c.kind}] ${c.text}`).join('\n'),
        claimIds: [...new Set(l.content.flatMap((c) => c.claimIds))],
        requiresReview: l.content.some((c) => c.requiresReview || c.kind === 'pending_validation'),
      });
    }
    for (const a of m.activities) elements.push({ ...ref(a.activityId, 'activity', a.title), text: a.instructions, claimIds: a.claimIds, requiresReview: a.requiresReview });
    for (const a of m.assessments) {
      elements.push({
        ...ref(a.assessmentId, 'assessment', a.question),
        text: `${a.question}${a.options.length ? ` Options: ${a.options.join(' | ')}.` : ''} Expected answer: ${a.correctAnswer}`,
        claimIds: a.claimIds,
        requiresReview: a.requiresReview,
      });
    }
  }
  return elements;
}

const refOf = (e: Element): ImpactElementRef => ({ elementId: e.elementId, elementType: e.elementType, moduleId: e.moduleId, title: e.title });

// ---------------------------------------------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------------------------------------------

function parseRequest(body: unknown): { from: number; to: number; proposalId: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Invalid impact analysis request: send a JSON object.');
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (!['from', 'to', 'proposalId'].includes(key)) problems.push(`"${key}" is not an allowed field`);
  for (const f of ['from', 'to']) if (!Number.isInteger(b[f]) || (b[f] as number) < 1) problems.push(`${f} must be a version number`);
  if (typeof b.proposalId !== 'string' || !PROPOSAL_ID_PATTERN.test(b.proposalId)) problems.push('proposalId must be a proposal id');
  if (problems.length === 0 && (b.from as number) >= (b.to as number)) problems.push('from must be an earlier version than to');
  if (problems.length > 0) throw new HttpError(400, `Invalid impact analysis request: ${problems.join('; ')}.`);
  return { from: b.from as number, to: b.to as number, proposalId: b.proposalId as string };
}

const inFlight = new Set<string>();

/**
 * Assesses with AI how the changes between two processed versions affect a learning proposal of the previous
 * version. The result is a recommendation for human review: no learning content is created or modified.
 * Every attempt is stored as a new immutable record (failed attempts included).
 */
export async function createImpactAnalysis(projectId: string, documentId: string, body: unknown, dependencies: ImpactDependencies = defaultDependencies): Promise<ImpactAnalysis> {
  const { from, to, proposalId } = parseRequest(body);
  const comparison = await compareVersions(projectId, documentId, String(from), String(to));
  const proposal = await proposalRepository.findById(proposalId);
  if (!proposal) throw new HttpError(404, 'Proposal not found.');
  if (proposal.documentId !== comparison.from.documentId || proposal.extractionId !== comparison.from.extractionId) {
    throw new HttpError(409, `This proposal was not generated from version ${from} of this document (its current extraction), so its impact cannot be assessed against these changes.`);
  }
  if (proposal.status !== 'draft' || !proposal.content || proposal.validationErrors.length > 0) {
    throw new HttpError(409, 'This proposal is a failed generation attempt without learning content.');
  }
  if (proposal.lineage && (await reviewStatusFor(proposal)) !== 'approved') {
    throw new HttpError(409, 'This proposal version was produced by a learning update that has not been approved; it cannot be evaluated yet.');
  }
  const changes = comparison.changes.filter((c) => c.type !== 'unchanged');
  if (changes.length === 0) throw new HttpError(409, 'The two versions have no differences in their extracted text, so there is nothing to assess.');

  let reviewStatus: ReviewStatus | 'unavailable';
  try {
    reviewStatus = reviewStatusOf(proposal, await reviewRepository.findByProposalId(proposalId));
  } catch (error) {
    console.error(`[impact] Review log of proposal ${proposalId} is unreadable`, error);
    reviewStatus = 'unavailable';
  }

  // -- context: elements, claims, unresolved issues (all from the stored proposal and its analysis) -------------
  const elements = catalogue(proposal);
  const elementById = new Map(elements.map((e) => [e.elementId, e]));
  const claimSources = new Map<string, string[]>();
  for (const r of proposal.sourceReferences) claimSources.set(r.claimId, [...new Set([...(claimSources.get(r.claimId) ?? []), r.sourceId])]);
  const sourceAnalysis = await analysisRepository.findById(proposal.analysisId);
  const claimStatus = new Map(sourceAnalysis?.claims.map((c) => [c.claimId, c.status]) ?? []);
  const unresolvedClaims = new Set([
    ...proposal.warnings.filter((w) => w.type === 'contradiction' || w.type === 'pending_validation').flatMap((w) => w.relatedClaimIds),
    ...[...claimStatus].filter(([, s]) => s === 'pending_validation').map(([id]) => id),
  ]);
  const linkedFor = (change: DocumentChange): string[] => {
    const previous = change.from?.sourceId;
    if (!previous) return [];
    const citing = new Set([...claimSources].filter(([, ids]) => ids.includes(previous)).map(([id]) => id));
    // Lessons, activities and assessments only (a module's claimIds aggregate its children's).
    return elements.filter((e) => e.elementType !== 'module' && e.claimIds.some((id) => citing.has(id))).map((e) => e.elementId);
  };
  const linked = new Map(changes.map((c) => [c.changeId, linkedFor(c)]));

  const side = (u: ComparedUnit | undefined) => (u ? { sourceId: u.sourceId, text: u.text } : null);
  const input: ImpactModelInput = {
    versions: { previous: from, new: to },
    changes: changes.map((c) => ({ changeId: c.changeId, type: c.type, previous: side(c.from), new: side(c.to), linkedElementIds: linked.get(c.changeId)! })),
    learningElements: elements.map((e) => ({ elementId: e.elementId, type: e.elementType, moduleId: e.moduleId, title: e.title, text: e.text, claimIds: e.claimIds })),
    claims: [...claimSources].map(([claimId, sourceIds]) => ({ claimId, status: claimStatus.get(claimId) ?? 'unknown', sourceIds })),
    unresolvedIssues: proposal.warnings
      .filter((w) => w.type === 'contradiction' || w.type === 'pending_validation')
      .map((w) => ({ type: w.type, message: w.message, claimIds: w.relatedClaimIds })),
  };
  if (JSON.stringify(input).length > MAX_INPUT_CHARS) {
    throw new HttpError(422, `The changes and the proposal are too large to assess in one request (limit ${MAX_INPUT_CHARS} characters).`);
  }

  let model: ImpactModel;
  try {
    model = dependencies.getModel();
  } catch (error) {
    if (error instanceof AIModelError && error.code === 'NOT_CONFIGURED') throw new HttpError(503, error.message);
    throw error;
  }

  const key = `${proposalId}:${comparison.comparisonId}`;
  if (inFlight.has(key)) throw new HttpError(409, 'An impact analysis for this proposal and these versions is already running.');
  inFlight.add(key);
  try {
    return await run();
  } finally {
    inFlight.delete(key);
  }

  async function run(): Promise<ImpactAnalysis> {
    const backendWarnings: ImpactWarning[] = [];
    const warn = (code: ImpactWarningCode, message: string) => backendWarnings.push({ source: 'backend', code, message });
    if (reviewStatus === 'rejected') warn('proposal_rejected', 'The evaluated proposal was rejected by a reviewer.');
    if (reviewStatus === 'pending_review') warn('proposal_pending_review', 'The evaluated proposal has not been reviewed yet.');
    if (reviewStatus === 'unavailable') warn('review_status_unavailable', 'The review status of the evaluated proposal could not be read.');
    if (!sourceAnalysis) warn('source_analysis_unavailable', 'The source analysis of the proposal could not be read; claim statuses are unknown.');

    const base = {
      schemaVersion: IMPACT_SCHEMA_VERSION,
      impactAnalysisId: randomUUID(),
      projectId,
      documentId: comparison.documentId,
      from: { version: comparison.from.version, documentId: comparison.from.documentId, extractionId: comparison.from.extractionId },
      to: { version: comparison.to.version, documentId: comparison.to.documentId, extractionId: comparison.to.extractionId },
      comparisonId: comparison.comparisonId,
      comparisonAlgorithm: comparison.algorithm,
      proposalId,
      proposalReviewStatus: reviewStatus,
      promptVersion: IMPACT_PROMPT_VERSION,
      createdAt: new Date().toISOString(),
    };
    const fail = async (code: AnalysisErrorCode, message: string, cause: unknown, reportedModel: string, validationErrors: string[] = [], rejectedResults: RejectedImpactResult[] = []): Promise<never> => {
      console.error(`[impact] ${base.impactAnalysisId} failed (${code})`, cause);
      await impactRepository.create({
        ...base, model: reportedModel, completedAt: new Date().toISOString(), status: 'failed', results: [], affectedElements: [],
        summary: { high: 0, medium: 0, low: 0, no_impact: 0, not_assessed: 0, requiresHumanReview: 0 },
        rejectedResults, warnings: backendWarnings, validationErrors, error: { code, message },
      });
      throw new HttpError(HTTP_STATUS_FOR[code], `${message} The failed attempt was recorded as impact analysis ${base.impactAnalysisId}.`);
    };

    let output;
    try {
      output = await model.assessImpact(input);
    } catch (error) {
      const aiError = error instanceof AIModelError ? error : new AIModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
      return fail(aiError.code === 'NOT_CONFIGURED' ? 'PROVIDER_ERROR' : aiError.code, aiError.message, aiError, model.model);
    }

    const validation = await validateOutput(output.data, { comparison, changes, elementById, claimSources, linked });
    if (validation.structuralErrors.length > 0 || validation.valid.size === 0) {
      const errors = validation.structuralErrors.length > 0 ? validation.structuralErrors : ['no result passed validation'];
      return fail('INVALID_RESPONSE', `The AI provider returned an impact assessment that failed validation (${errors.length} problem(s)).`, errors, output.model, errors, validation.rejected);
    }

    // -- one result per changed unit, in document order ------------------------------------------------------------
    const results: ImpactResult[] = [];
    for (const change of changes) {
      const linkedIds = linked.get(change.changeId)!;
      const ownEvidence = await evidenceFor([change.from?.sourceId, change.to?.sourceId].filter((s): s is string => Boolean(s)), comparison);
      const v = validation.valid.get(change.changeId);
      const reasons = new Set<ImpactReviewReason>();
      const affected = v ? v.affectedElementIds.map((id) => elementById.get(id)!) : [];
      if (!v) reasons.add('not_assessed');
      if (v?.certainty === 'uncertain') reasons.add('uncertain');
      if (v && v.impact !== 'no_impact' && affected.length === 0) reasons.add('no_element_identified');
      if (v && linkedIds.some((id) => !v.affectedElementIds.includes(id))) reasons.add('linked_elements_not_listed');
      const touched = [...affected, ...linkedIds.map((id) => elementById.get(id)!)];
      if (touched.some((e) => e.claimIds.some((id) => unresolvedClaims.has(id)))) reasons.add('unresolved_issue');
      if (affected.some((e) => e.requiresReview)) reasons.add('element_requires_review');
      const extra = v ? v.evidence.filter((e) => !ownEvidence.some((o) => o.sourceId === e.sourceId)) : [];
      results.push({
        changeId: change.changeId,
        changeType: change.type as ImpactResult['changeType'],
        impact: v?.impact ?? null,
        certainty: v?.certainty ?? 'uncertain',
        justification: v?.justification ?? 'No valid AI assessment is available for this change.',
        reviewRecommendation: v?.reviewRecommendation ?? 'Review this change manually against the learning content.',
        affectedElements: affected.map(refOf),
        evidence: [...ownEvidence, ...extra],
        linkedElementIds: linkedIds,
        requiresHumanReview: reasons.size > 0,
        reviewReasons: [...reasons],
        origin: v ? 'ai' : 'backend',
      });
    }

    const affectedElements = new Map<string, AffectedElementSummary>();
    for (const r of results) {
      if (!r.impact || r.impact === 'no_impact') continue;
      for (const e of r.affectedElements) {
        const current = affectedElements.get(e.elementId);
        if (!current) affectedElements.set(e.elementId, { ...e, highestImpact: r.impact, changeIds: [r.changeId] });
        else {
          current.changeIds.push(r.changeId);
          if (RANK[r.impact] > RANK[current.highestImpact]) current.highestImpact = r.impact;
        }
      }
    }
    const order = new Map(elements.map((e, i) => [e.elementId, i]));
    const summary = { high: 0, medium: 0, low: 0, no_impact: 0, not_assessed: 0, requiresHumanReview: 0 };
    for (const r of results) {
      summary[r.impact ?? 'not_assessed']++;
      if (r.requiresHumanReview) summary.requiresHumanReview++;
    }
    if (validation.rejected.length > 0) warn('rejected_results', `${validation.rejected.length} AI result(s) failed validation and were discarded; see rejectedResults.`);
    if (summary.not_assessed > 0) warn('not_assessed', `${summary.not_assessed} change(s) have no valid AI assessment and must be reviewed manually.`);

    const analysis: ImpactAnalysis = {
      ...base,
      model: output.model,
      completedAt: new Date().toISOString(),
      status: 'completed',
      results,
      affectedElements: [...affectedElements.values()].sort((a, b) => RANK[b.highestImpact] - RANK[a.highestImpact] || order.get(a.elementId)! - order.get(b.elementId)!),
      summary,
      rejectedResults: validation.rejected,
      warnings: [...backendWarnings, ...validation.warnings.map((message) => ({ source: 'ai' as const, code: null, message }))],
      validationErrors: [],
      error: null,
    };
    await impactRepository.create(analysis);
    return analysis;
  }
}

/** Resolves source ids through the E2.4 source system and checks they belong to one of the compared versions. */
export async function evidenceFor(sourceIds: string[], comparison: Pick<DocumentComparison, 'from' | 'to'>): Promise<ImpactEvidence[]> {
  const evidence: ImpactEvidence[] = [];
  for (const sourceId of sourceIds) {
    const parsed = parseSourceId(sourceId);
    const side = [comparison.from, comparison.to].find((v) => v.documentId === parsed?.documentId && v.extractionId === parsed?.extractionId);
    if (!side) throw new HttpError(422, `Source ${sourceId} does not belong to the compared versions.`);
    const fragment = await resolveSource(sourceId);
    evidence.push({ sourceId, version: side.version, documentId: fragment.documentId, extractionId: fragment.extractionId, locator: fragment.locator, text: fragment.text });
  }
  return evidence;
}

interface ValidResult {
  impact: ImpactLevel;
  certainty: ImpactCertainty;
  justification: string;
  reviewRecommendation: string;
  affectedElementIds: string[];
  evidence: ImpactEvidence[];
}

/**
 * Validates the untrusted model output. Structural problems fail the whole attempt; an invalid result is
 * discarded (kept in rejectedResults) and its change is reported as not assessed.
 */
async function validateOutput(
  data: unknown,
  ctx: {
    comparison: DocumentComparison;
    changes: DocumentChange[];
    elementById: Map<string, Element>;
    claimSources: Map<string, string[]>;
    linked: Map<string, string[]>;
  },
): Promise<{ valid: Map<string, ValidResult>; rejected: RejectedImpactResult[]; warnings: string[]; structuralErrors: string[] }> {
  const valid = new Map<string, ValidResult>();
  const rejected: RejectedImpactResult[] = [];
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { valid, rejected, warnings: [], structuralErrors: ['output must be an object'] };
  const d = data as Record<string, unknown>;
  const structuralErrors: string[] = [];
  if (!Array.isArray(d.results)) structuralErrors.push('"results" must be an array');
  if (!Array.isArray(d.warnings) || !d.warnings.every((w) => typeof w === 'string')) structuralErrors.push('"warnings" must be an array of strings');
  if (structuralErrors.length > 0) return { valid, rejected, warnings: [], structuralErrors };

  const changeById = new Map(ctx.changes.map((c) => [c.changeId, c]));
  for (const raw of d.results as unknown[]) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const changeId = typeof r.changeId === 'string' ? r.changeId : null;
    const reasons: string[] = [];
    const change = changeId ? changeById.get(changeId) : undefined;
    if (!change) reasons.push(changeId ? `unknown change "${changeId}" (not a changed unit of this comparison)` : 'missing changeId');
    else if (valid.has(change.changeId)) reasons.push('duplicate assessment for this change');
    if (!IMPACT_LEVELS.includes(r.impact as ImpactLevel)) reasons.push('invalid impact level');
    if (!IMPACT_CERTAINTIES.includes(r.certainty as ImpactCertainty)) reasons.push('invalid certainty');
    for (const f of ['justification', 'reviewRecommendation'] as const) {
      if (typeof r[f] !== 'string' || !(r[f] as string).trim()) reasons.push(`${f} is required`);
      else if ((r[f] as string).length > MAX_TEXT[f]) reasons.push(`${f} is longer than ${MAX_TEXT[f]} characters`);
    }
    const elementIds = Array.isArray(r.affectedElementIds) && r.affectedElementIds.every((x) => typeof x === 'string') ? [...new Set(r.affectedElementIds as string[])] : null;
    if (!elementIds) reasons.push('affectedElementIds must be an array of ids');
    else for (const id of elementIds) if (!ctx.elementById.has(id)) reasons.push(`unknown learning element "${id}"`);
    if (r.impact === 'no_impact' && elementIds && elementIds.length > 0) reasons.push('a no_impact result cannot list affected elements');
    const sourceIds = Array.isArray(r.evidenceSourceIds) && r.evidenceSourceIds.every((x) => typeof x === 'string') ? [...new Set(r.evidenceSourceIds as string[])] : null;
    if (!sourceIds) reasons.push('evidenceSourceIds must be an array of source ids');

    let evidence: ImpactEvidence[] = [];
    if (reasons.length === 0 && change && elementIds && sourceIds) {
      // Allowed references: the change's own passages and the passages behind the claims of the affected elements.
      const allowed = new Set([change.from?.sourceId, change.to?.sourceId].filter(Boolean) as string[]);
      for (const id of [...elementIds, ...(ctx.linked.get(change.changeId) ?? [])]) {
        for (const claimId of ctx.elementById.get(id)!.claimIds) for (const s of ctx.claimSources.get(claimId) ?? []) allowed.add(s);
      }
      for (const s of sourceIds) if (!allowed.has(s)) reasons.push(`reference "${s}" is not a passage of this change or of the affected elements`);
      if (reasons.length === 0) {
        try {
          evidence = await evidenceFor(sourceIds, ctx.comparison);
        } catch (error) {
          if (error instanceof HttpError && error.status < 500) reasons.push(`a reference cannot be resolved: ${error.message}`);
          else throw error;
        }
      }
    }
    if (reasons.length > 0) {
      rejected.push({ changeId, reasons });
      continue;
    }
    valid.set(change!.changeId, {
      impact: r.impact as ImpactLevel,
      certainty: r.certainty as ImpactCertainty,
      justification: (r.justification as string).trim(),
      reviewRecommendation: (r.reviewRecommendation as string).trim(),
      affectedElementIds: elementIds!,
      evidence,
    });
  }
  const warnings = (d.warnings as string[]).map((w) => w.trim()).filter(Boolean).slice(0, 20).map((w) => w.slice(0, MAX_TEXT.warning));
  return { valid, rejected, warnings, structuralErrors: [] };
}

// ---------------------------------------------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------------------------------------------

export interface ImpactAnalysisSummary {
  impactAnalysisId: string;
  documentId: string;
  from: ImpactAnalysis['from'];
  to: ImpactAnalysis['to'];
  comparisonId: string;
  proposalId: string;
  proposalReviewStatus: ImpactAnalysis['proposalReviewStatus'];
  status: ImpactAnalysis['status'];
  model: string;
  promptVersion: string;
  createdAt: string;
  completedAt: string;
  summary: ImpactAnalysis['summary'];
  affectedElementCount: number;
  error: ImpactAnalysis['error'];
}

/** Impact analyses of a logical document (optionally filtered by versions or proposal), newest first. */
export async function listImpactAnalyses(projectId: string, documentId: string, query: Record<string, unknown>): Promise<ImpactAnalysisSummary[]> {
  await getLogicalDocument(projectId, documentId);
  const num = (v: unknown) => (typeof v === 'string' && /^[1-9]\d*$/.test(v) ? Number(v) : undefined);
  for (const f of ['from', 'to'] as const) if (query[f] !== undefined && num(query[f]) === undefined) throw new HttpError(400, `"${f}" must be a version number.`);
  const from = num(query.from), to = num(query.to);
  const proposalId = typeof query.proposalId === 'string' ? query.proposalId : undefined;
  return (await impactRepository.findByDocumentId(documentId))
    .filter((a) => a.projectId === projectId && (from === undefined || a.from.version === from) && (to === undefined || a.to.version === to) && (!proposalId || a.proposalId === proposalId))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt) || y.completedAt.localeCompare(x.completedAt))
    .map((a) => ({
      impactAnalysisId: a.impactAnalysisId, documentId: a.documentId, from: a.from, to: a.to, comparisonId: a.comparisonId, proposalId: a.proposalId,
      proposalReviewStatus: a.proposalReviewStatus, status: a.status, model: a.model, promptVersion: a.promptVersion, createdAt: a.createdAt,
      completedAt: a.completedAt, summary: a.summary, affectedElementCount: a.affectedElements.length, error: a.error,
    }));
}

export async function getImpactAnalysis(id: string): Promise<ImpactAnalysis> {
  if (!IMPACT_ID_PATTERN.test(id)) throw new HttpError(400, 'Malformed impact analysis id.');
  const analysis = await impactRepository.findById(id);
  if (!analysis) throw new HttpError(404, 'Impact analysis not found.');
  return analysis;
}
