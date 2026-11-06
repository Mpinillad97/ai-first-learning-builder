import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { ANALYSIS_ID_PATTERN, analysisRepository } from '../repositories/analysis.repository.js';
import { documentRepository } from '../repositories/document.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import { PROPOSAL_ID_PATTERN, proposalRepository } from '../repositories/proposal.repository.js';
import type { Analysis, AnalysisErrorCode, Claim } from '../types/analysis.types.js';
import {
  PROPOSAL_SCHEMA_VERSION,
  type LearningProposal,
  type Module,
  type ProposalWarning,
  type SourceReference,
  type WarningType,
} from '../types/proposal.types.js';
import { AIModelError } from './ai-client.js';
import { getProposalModel, PROPOSAL_PROMPT_VERSION, type ProposalModel } from './proposal-model.js';
import { validateProposal, type ClaimContext, type ValidatedProposal } from './proposal-validation.js';
import { parseSourceId, resolveSource } from './source.service.js';

export interface ProposalDependencies {
  getModel: () => ProposalModel;
}

const defaultDependencies: ProposalDependencies = { getModel: getProposalModel };

const HTTP_STATUS_FOR: Record<AnalysisErrorCode, number> = {
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
  INVALID_RESPONSE: 502,
  REFUSAL: 502,
};

type V2Analysis = Analysis & Required<Pick<Analysis, 'contradictions' | 'documentationGaps'>>;

/**
 * Re-verifies a claim's stored evidence against the analysis' exact extraction: each source id must belong to
 * it, resolve, and still contain the quote at the stored offsets. Returns the problems found.
 */
async function reverifyClaim(claim: Claim, analysis: Analysis): Promise<string[]> {
  if (claim.evidence.length === 0) return ['has no evidence'];
  const problems: string[] = [];
  for (const ev of claim.evidence) {
    const parsed = parseSourceId(ev.sourceId);
    if (!parsed || parsed.documentId !== analysis.documentId || parsed.extractionId !== analysis.extractionId) {
      problems.push(`evidence source ${ev.sourceId} does not belong to the analyzed extraction`);
      continue;
    }
    try {
      const fragment = await resolveSource(ev.sourceId);
      if (fragment.text.slice(ev.startOffset, ev.endOffset) !== ev.quote) problems.push(`evidence at ${ev.sourceId} no longer matches the source text`);
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) problems.push(`evidence source ${ev.sourceId} cannot be resolved`);
      else throw error;
    }
  }
  return problems;
}

function warning(type: WarningType, message: string, related: Partial<Pick<ProposalWarning, 'relatedClaimIds' | 'relatedContradictionIds' | 'relatedGapIds'>> = {}) {
  return {
    type,
    message,
    relatedClaimIds: related.relatedClaimIds ?? [],
    relatedContradictionIds: related.relatedContradictionIds ?? [],
    relatedGapIds: related.relatedGapIds ?? [],
    requiresHumanReview: true as const,
  };
}

/**
 * Generates a draft learning proposal from a completed schemaVersion 2 analysis. Never re-analyzes the
 * document. The result is always a "draft" for human review; failed attempts are recorded as "failed".
 */
export async function generateProposal(
  analysisId: string,
  dependencies: ProposalDependencies = defaultDependencies,
): Promise<LearningProposal> {
  if (!ANALYSIS_ID_PATTERN.test(analysisId)) throw new HttpError(400, 'Malformed analysis id.');
  const stored = await analysisRepository.findById(analysisId);
  if (!stored) throw new HttpError(404, 'Analysis not found.');
  if (stored.schemaVersion !== 2) {
    throw new HttpError(409, 'This analysis uses an earlier format without contradiction and gap detection. Run a new analysis first.');
  }
  if (stored.status !== 'completed') throw new HttpError(409, 'Only completed analyses can be used to generate a proposal.');
  const analysis = stored as V2Analysis;

  if (!(await documentRepository.findById(analysis.documentId))) throw new HttpError(409, 'The analyzed document no longer exists.');
  const extraction = await extractionRepository.findInHistory(analysis.documentId, analysis.extractionId);
  if (!extraction) throw new HttpError(409, 'The extraction used by this analysis is not available.');

  // -- trusted claim set: re-verified evidence only ---------------------------------------
  const backendWarnings: ReturnType<typeof warning>[] = [];
  const verifiedClaims: Claim[] = [];
  for (const claim of analysis.claims) {
    const problems = await reverifyClaim(claim, analysis);
    if (problems.length > 0) {
      backendWarnings.push(warning('analysis_warning', `${claim.claimId} was excluded: its evidence could not be re-verified (${problems.join('; ')}).`, { relatedClaimIds: [claim.claimId] }));
    } else {
      verifiedClaims.push(claim);
    }
  }
  const confirmed = verifiedClaims.filter((c) => c.status === 'confirmed');
  const pending = verifiedClaims.filter((c) => c.status === 'pending_validation');
  if (confirmed.length === 0) {
    throw new HttpError(409, 'The analysis has no confirmed claims with verified evidence, so no factual learning content can be generated.');
  }

  const claimsUnderReview = new Set(analysis.contradictions.flatMap((c) => c.claimIds));
  const gapSources = new Set(analysis.documentationGaps.flatMap((g) => g.relatedEvidence.map((e) => e.sourceId)));
  for (const claim of verifiedClaims) if (claim.evidence.some((e) => gapSources.has(e.sourceId))) claimsUnderReview.add(claim.claimId);

  // -- warnings the backend always carries over ----------------------------------------------
  for (const c of analysis.contradictions) {
    backendWarnings.push(warning('contradiction', `Unresolved contradiction ${c.contradictionId} (${c.severity}): ${c.description}`, {
      relatedClaimIds: c.claimIds, relatedContradictionIds: [c.contradictionId],
    }));
  }
  for (const g of analysis.documentationGaps) {
    backendWarnings.push(warning('documentation_gap', `Not documented (${g.category}) — ${g.topic}: ${g.description}`, { relatedGapIds: [g.gapId] }));
  }
  if (pending.length > 0) {
    backendWarnings.push(warning('pending_validation', `${pending.length} claim(s) are pending validation and cannot be taught as facts until a human validates them.`, {
      relatedClaimIds: pending.map((c) => c.claimId),
    }));
  }
  for (const w of analysis.warnings) backendWarnings.push(warning('analysis_warning', `Source analysis: ${w}`));
  if (!extraction.isCurrent) {
    backendWarnings.push(warning('analysis_warning', 'The source analysis is based on a historical extraction; the document has been reprocessed since.'));
  }

  // -- model -------------------------------------------------------------------------------------
  let model: ProposalModel;
  try {
    model = dependencies.getModel();
  } catch (error) {
    if (error instanceof AIModelError && error.code === 'NOT_CONFIGURED') throw new HttpError(503, error.message);
    throw error;
  }

  const proposalId = randomUUID();
  const base = {
    schemaVersion: PROPOSAL_SCHEMA_VERSION,
    proposalId,
    analysisId,
    documentId: analysis.documentId,
    extractionId: analysis.extractionId,
    sourceSha256: analysis.sourceSha256,
    promptVersion: PROPOSAL_PROMPT_VERSION,
    createdAt: new Date().toISOString(),
  };
  const fail = async (code: AnalysisErrorCode, message: string, cause: unknown, reportedModel: string, validationErrors: string[] = []): Promise<never> => {
    console.error(`[proposal] ${proposalId} for analysis ${analysisId} failed (${code})`, cause);
    await proposalRepository.create({
      ...base,
      model: reportedModel,
      completedAt: new Date().toISOString(),
      status: 'failed',
      content: null,
      sourceReferences: [],
      warnings: [],
      rejectedItems: [],
      validationErrors,
      error: { code, message },
    });
    throw new HttpError(HTTP_STATUS_FOR[code], `${message} The failed attempt was recorded as proposal ${proposalId}.`);
  };

  const claimInput = (c: Claim) => ({ claimId: c.claimId, text: c.text, quotes: c.evidence.map((e) => e.quote) });
  let output;
  try {
    output = await model.generateProposal({
      document: analysis.documentId,
      confirmedClaims: confirmed.map(claimInput),
      pendingClaims: pending.map(claimInput),
      contradictions: analysis.contradictions.map((c) => ({ contradictionId: c.contradictionId, description: c.description, claimIds: c.claimIds })),
      documentationGaps: analysis.documentationGaps.map((g) => ({ gapId: g.gapId, topic: g.topic, description: g.description })),
    });
  } catch (error) {
    const aiError = error instanceof AIModelError ? error : new AIModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
    return fail(aiError.code === 'NOT_CONFIGURED' ? 'PROVIDER_ERROR' : aiError.code, aiError.message, aiError, model.model);
  }

  // -- validation ----------------------------------------------------------------------------------
  const claims = new Map<string, ClaimContext>(verifiedClaims.map((c) => [c.claimId, { claimId: c.claimId, status: c.status, quotes: c.evidence.map((e) => e.quote) }]));
  const validation = validateProposal(output.data, {
    claims,
    contradictionIds: new Set(analysis.contradictions.map((c) => c.contradictionId)),
    gapIds: new Set(analysis.documentationGaps.map((g) => g.gapId)),
    claimsUnderReview,
  });
  if (!validation.proposal) {
    return fail('INVALID_RESPONSE', `The AI provider returned a proposal that failed validation (${validation.errors.length} problem(s)).`,
      validation.errors, output.model, validation.errors);
  }

  const proposal = assemble(base, output.model, validation.proposal, verifiedClaims, backendWarnings, validation.rejectedItems, validation.notes);
  await proposalRepository.create(proposal);
  return proposal;
}

/** Builds the stored proposal: backend ids, backend-derived evidence, merged warnings, status draft. */
function assemble(
  base: Omit<LearningProposal, 'model' | 'completedAt' | 'status' | 'content' | 'sourceReferences' | 'warnings' | 'rejectedItems' | 'validationErrors' | 'error'>,
  model: string,
  validated: ValidatedProposal,
  claims: Claim[],
  backendWarnings: ReturnType<typeof warning>[],
  rejectedItems: LearningProposal['rejectedItems'],
  notes: string[],
): LearningProposal {
  const byId = new Map(claims.map((c) => [c.claimId, c]));
  const referencesFor = (ids: Iterable<string>): SourceReference[] =>
    [...new Set(ids)].flatMap((id) =>
      (byId.get(id)?.evidence ?? []).map((e) => ({ claimId: id, sourceId: e.sourceId, locator: e.locator, quote: e.quote, startOffset: e.startOffset, endOffset: e.endOffset })));

  let lessonCount = 0, activityCount = 0, assessmentCount = 0;
  const modules: Module[] = validated.modules.map((m, index) => {
    const lessons = m.lessons.map((l, order) => ({ lessonId: `les_${++lessonCount}`, order: order + 1, title: l.title, content: l.content }));
    const activities = m.activities.map((a) => ({ activityId: `act_${++activityCount}`, ...a }));
    const assessments = m.assessments.map((a) => ({ assessmentId: `asm_${++assessmentCount}`, ...a }));
    const claimIds = [...new Set([
      ...m.suggestedDuration.claimIds,
      ...lessons.flatMap((l) => l.content.flatMap((c) => c.claimIds)),
      ...activities.flatMap((a) => a.claimIds),
      ...assessments.flatMap((a) => a.claimIds),
    ])];
    return {
      moduleId: `mod_${index + 1}`, order: index + 1, title: m.title, learningObjective: m.learningObjective,
      suggestedDuration: m.suggestedDuration, lessons, activities, assessments, claimIds, evidence: referencesFor(claimIds),
    };
  });

  const usedClaimIds = [
    ...validated.audience.claimIds, ...validated.prerequisites.claimIds, ...validated.estimatedDuration.claimIds,
    ...modules.flatMap((m) => m.claimIds),
  ];
  if (rejectedItems.length > 0) notes.push(`${rejectedItems.length} generated item(s) were removed because they were not supported by confirmed claims; see rejectedItems.`);
  const warnings: ProposalWarning[] = [
    ...backendWarnings,
    ...notes.map((n) => warning('proposal', n)),
    ...validated.warnings.map((w) => ({ type: 'proposal' as const, ...w, requiresHumanReview: true as const })),
  ].map((w, i) => ({ warningId: `wrn_${i + 1}`, ...w }));

  return {
    ...base,
    model,
    completedAt: new Date().toISOString(),
    status: 'draft', // assigned here, never taken from the model
    content: {
      title: validated.title,
      learningObjective: validated.learningObjective,
      audience: validated.audience,
      prerequisites: validated.prerequisites,
      estimatedDuration: validated.estimatedDuration,
      modules,
    },
    sourceReferences: referencesFor(usedClaimIds),
    warnings,
    rejectedItems,
    validationErrors: [],
    error: null,
  };
}

export async function getProposal(proposalId: string): Promise<LearningProposal> {
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) throw new HttpError(400, 'Malformed proposal id.');
  const proposal = await proposalRepository.findById(proposalId);
  if (!proposal) throw new HttpError(404, 'Proposal not found.');
  return proposal;
}
