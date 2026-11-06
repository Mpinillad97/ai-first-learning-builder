import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { ANALYSIS_ID_PATTERN, analysisRepository } from '../repositories/analysis.repository.js';
import { documentRepository } from '../repositories/document.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import {
  ANALYSIS_SCHEMA_VERSION,
  type Analysis,
  type AnalysisErrorCode,
  type Claim,
  type ClaimEvidence,
  type ClaimStatus,
  type Contradiction,
  type ContradictionSeverity,
  type DocumentationGap,
  type GapCategory,
  type RejectedClaim,
  type RejectedContradiction,
  type RejectedGap,
  type RejectionCategory,
} from '../types/analysis.types.js';
import type { IdentifiedExtraction } from '../types/extraction.types.js';
import type { SourceFragment } from '../types/source.types.js';
import { ClaimModelError, getClaimModel, PROMPT_VERSION, type ClaimModel } from './claim-model.js';
import {
  areDistinctPassages,
  assertsAbsenceOfCapability,
  auditEvidence,
  auditText,
  favoursOneSide,
  isClaimStatus,
  locateQuote,
  readProposedAnalysis,
  riskyCapabilities,
  toAuditCopy,
  unsupportedContent,
  type ProposedEvidence,
} from './claim-validation.js';
import { buildSourceId, parseSourceId, resolveSource } from './source.service.js';

/** Upper bound on documentation text sent in one request; larger documents are rejected, never truncated. */
export const MAX_ANALYSIS_INPUT_CHARS = 300_000;

export interface AnalysisDependencies {
  getModel: () => ClaimModel;
}

const defaultDependencies: AnalysisDependencies = { getModel: getClaimModel };

const HTTP_STATUS_FOR: Record<AnalysisErrorCode, number> = {
  PROVIDER_ERROR: 502,
  PROVIDER_TIMEOUT: 504,
  INVALID_RESPONSE: 502,
  REFUSAL: 502,
};

function hasIdentity(extraction: object): extraction is IdentifiedExtraction {
  return 'extractionId' in extraction && 'sourceSha256' in extraction && 'extractorVersion' in extraction;
}

/** Citable fragments of an extraction: non-empty pages or paragraphs, with their stable source ids. */
function fragmentsOf(extraction: IdentifiedExtraction): { sourceId: string; text: string }[] {
  const { documentId, extractionId } = extraction;
  return extraction.format === 'pdf'
    ? extraction.pages
        .filter((p) => p.text.length > 0)
        .map((p) => ({ sourceId: buildSourceId(documentId, extractionId, { type: 'pdf-page', pageNumber: p.pageNumber }), text: p.text }))
    : extraction.paragraphs
        .filter((p) => p.text.length > 0)
        .map((p) => ({
          sourceId: buildSourceId(documentId, extractionId, { type: 'docx-paragraph', paragraphIndex: p.paragraphIndex }),
          text: p.text,
        }));
}

type Verified = { ok: true; evidence: ClaimEvidence } | { ok: false; reason: string; category: RejectionCategory };

/**
 * Verifies one evidence item independently of the model: the source id must belong to the analyzed
 * extraction and resolve through the regular source resolution; the quote must occur exactly once in the
 * fragment text. Offsets are computed here (UTF-16, start inclusive, end exclusive).
 */
async function verifyEvidence(
  item: ProposedEvidence,
  extraction: IdentifiedExtraction,
  resolve: (sourceId: string) => Promise<SourceFragment | string>,
): Promise<Verified> {
  const invalid = (reason: string): Verified => ({ ok: false, reason, category: 'invalid_reference' });
  const parsed = parseSourceId(item.sourceId);
  if (!parsed) return invalid(`source id "${item.sourceId}" is malformed`);
  if (parsed.documentId !== extraction.documentId || parsed.extractionId !== extraction.extractionId) {
    return invalid(`source id "${item.sourceId}" does not belong to the analyzed extraction`);
  }
  const fragment = await resolve(item.sourceId);
  if (typeof fragment === 'string') return invalid(`source id "${item.sourceId}" could not be resolved: ${fragment}`);

  const location = locateQuote(fragment.text, item.quote);
  if (!location.ok) return { ok: false, reason: `source "${item.sourceId}": ${location.reason}`, category: 'unverified_quote' };
  return {
    ok: true,
    evidence: {
      sourceId: fragment.sourceId,
      locator: fragment.locator,
      quote: item.quote,
      startOffset: location.startOffset,
      endOffset: location.endOffset,
    },
  };
}

/** Resolves each source id at most once per analysis. Client-side resolution failures become a reason string. */
function cachedResolver(): (sourceId: string) => Promise<SourceFragment | string> {
  const cache = new Map<string, Promise<SourceFragment | string>>();
  return (sourceId) => {
    let result = cache.get(sourceId);
    if (!result) {
      result = resolveSource(sourceId).catch((error: unknown) => {
        if (error instanceof HttpError && error.status < 500) return error.message;
        throw error; // storage problems abort the analysis
      });
      cache.set(sourceId, result);
    }
    return result;
  };
}

type Issue = { category: RejectionCategory; reason: string };

/** Verifies every evidence item; returns the verified items and one issue per failure. */
async function verifyAll(
  items: ProposedEvidence[],
  extraction: IdentifiedExtraction,
  resolve: (sourceId: string) => Promise<SourceFragment | string>,
): Promise<{ evidence: ClaimEvidence[]; issues: Issue[] }> {
  const evidence: ClaimEvidence[] = [];
  const issues: Issue[] = [];
  for (const item of items) {
    const result = await verifyEvidence(item, extraction, resolve);
    if (result.ok) evidence.push(result.evidence);
    else issues.push({ category: result.category, reason: result.reason });
  }
  return { evidence, issues };
}

const unique = <T>(values: T[]): T[] => [...new Set(values)];

/**
 * Validates the model output against the analyzed extraction. Classification rules enforced here, never
 * taken on the model's word: a claim needs verified evidence; it is rejected when it states figures or risky
 * capabilities its quotes do not; it is never promoted, only downgraded (risky wording, involvement in a
 * contradiction). Contradictions need two verified, distinct passages and stay pending_review. Gaps may
 * not assert that a capability is absent.
 */
async function evaluateAnalysis(data: unknown, extraction: IdentifiedExtraction) {
  const proposed = readProposedAnalysis(data);
  if (!proposed) return null;

  const resolve = cachedResolver();
  const warnings: string[] = [];

  // -- claims -----------------------------------------------------------------
  const claims: Claim[] = [];
  const rejectedClaims: RejectedClaim[] = [];
  const claimIdByIndex = new Map<number, string>();

  for (const [index, candidate] of proposed.claims.entries()) {
    const issues: Issue[] = candidate.problems.map((reason) => ({
      category: reason.startsWith('at least one evidence') ? 'missing_evidence' : 'malformed',
      reason,
    }));
    let evidence: ClaimEvidence[] = [];
    if (issues.length === 0) {
      const verified = await verifyAll(candidate.evidence, extraction, resolve);
      evidence = verified.evidence;
      issues.push(...verified.issues);
    }
    if (issues.length === 0) issues.push(...unsupportedContent(candidate.text, evidence.map((e) => e.quote)));
    if (issues.length > 0 || !isClaimStatus(candidate.status)) {
      rejectedClaims.push({
        ...toAuditCopy(candidate),
        reasons: issues.map((i) => i.reason),
        categories: unique(issues.map((i) => i.category)),
      });
      continue;
    }

    const claimId = `clm_${claims.length + 1}`;
    let status: ClaimStatus = candidate.status;
    const risks = riskyCapabilities(candidate.text); // all quoted (unquoted ones were rejected as overreach)
    if (status === 'confirmed' && risks.length > 0) {
      status = 'pending_validation';
      const what = risks.map((r) => (r === 'automation' ? 'automation' : r === 'no user review' ? 'skipping review' : 'a guarantee')).join(' and ');
      warnings.push(`${claimId}: mentions ${what}; classified as pending_validation for human validation.`);
    }
    claims.push({ claimId, text: candidate.text, status, evidence });
    claimIdByIndex.set(index, claimId);
  }

  // -- contradictions -----------------------------------------------------------
  const contradictions: Contradiction[] = [];
  const rejectedContradictions: RejectedContradiction[] = [];

  for (const candidate of proposed.contradictions) {
    const reasons = [...candidate.problems];
    let evidence: ClaimEvidence[] = [];
    if (reasons.length === 0) {
      const verified = await verifyAll(candidate.evidence, extraction, resolve);
      evidence = verified.evidence;
      reasons.push(...verified.issues.map((i) => i.reason));
    }
    if (reasons.length === 0 && !evidence.some((a, i) => evidence.slice(i + 1).some((b) => areDistinctPassages(a, b)))) {
      reasons.push('a contradiction needs at least two distinct, non-overlapping passages (one per side)');
    }
    const claimIds: string[] = [];
    const droppedIndexes: number[] = [];
    for (const claimIndex of candidate.claimIndexes) {
      if (claimIndex >= proposed.claims.length) reasons.push(`claim index ${claimIndex} does not refer to a proposed claim`);
      else if (claimIdByIndex.has(claimIndex)) claimIds.push(claimIdByIndex.get(claimIndex)!);
      else droppedIndexes.push(claimIndex);
    }
    if (reasons.length > 0) {
      rejectedContradictions.push({
        description: auditText(candidate.description),
        severity: auditText(candidate.severity),
        claimIndexes: candidate.claimIndexes,
        evidence: auditEvidence(candidate.evidence),
        reasons,
      });
      continue;
    }

    const contradictionId = `ctr_${contradictions.length + 1}`;
    contradictions.push({
      contradictionId,
      description: candidate.description,
      severity: candidate.severity as ContradictionSeverity,
      claimIds,
      evidence,
      status: 'pending_review',
    });
    if (droppedIndexes.length > 0) {
      warnings.push(`${contradictionId}: refers to claim(s) at index ${droppedIndexes.join(', ')} that failed verification; only verified claims are linked.`);
    }
    if (favoursOneSide(candidate.description)) {
      warnings.push(`${contradictionId}: the description appears to favour one side; both sides are preserved and the conflict remains pending_review.`);
    }
    for (const claimId of claimIds) {
      const claim = claims.find((c) => c.claimId === claimId)!;
      if (claim.status === 'confirmed') {
        claim.status = 'pending_validation';
        warnings.push(`${claimId}: involved in ${contradictionId}; classified as pending_validation until a human resolves the conflict.`);
      }
    }
  }

  // -- documentation gaps --------------------------------------------------------
  const documentationGaps: DocumentationGap[] = [];
  const rejectedGaps: RejectedGap[] = [];

  for (const candidate of proposed.gaps) {
    const reasons = [...candidate.problems];
    if (reasons.length === 0 && (assertsAbsenceOfCapability(candidate.description) || assertsAbsenceOfCapability(candidate.relevance))) {
      reasons.push('the gap asserts that a capability does not exist; a gap may only state that the documentation does not establish it');
    }
    let relatedEvidence: ClaimEvidence[] = [];
    if (reasons.length === 0) {
      const verified = await verifyAll(candidate.relatedEvidence, extraction, resolve);
      relatedEvidence = verified.evidence;
      reasons.push(...verified.issues.map((i) => i.reason));
    }
    if (reasons.length > 0) {
      rejectedGaps.push({
        topic: auditText(candidate.topic),
        category: auditText(candidate.category),
        description: auditText(candidate.description),
        relevance: auditText(candidate.relevance),
        relatedEvidence: auditEvidence(candidate.relatedEvidence),
        reasons,
      });
      continue;
    }
    documentationGaps.push({
      gapId: `gap_${documentationGaps.length + 1}`,
      topic: candidate.topic,
      category: candidate.category as GapCategory,
      description: candidate.description,
      relevance: candidate.relevance,
      status: 'not_documented',
      relatedEvidence,
    });
  }

  // -- summary warnings --------------------------------------------------------------
  if (rejectedClaims.length > 0) {
    warnings.push(`${rejectedClaims.length} proposed claim(s) failed evidence verification and were not accepted.`);
  }
  if (rejectedContradictions.length > 0) {
    warnings.push(`${rejectedContradictions.length} proposed contradiction(s) failed verification and were not accepted.`);
  }
  if (rejectedGaps.length > 0) warnings.push(`${rejectedGaps.length} proposed documentation gap(s) failed validation and were not accepted.`);
  const unanchored = documentationGaps.filter((g) => g.relatedEvidence.length === 0).map((g) => g.gapId);
  if (unanchored.length > 0) warnings.push(`${unanchored.join(', ')}: no related source reference; confirm the gap concerns a documented feature.`);
  if (claims.length === 0) warnings.push('No verified claims were extracted from this document.');

  return { claims, rejectedClaims, contradictions, rejectedContradictions, documentationGaps, rejectedGaps, warnings };
}

/**
 * Runs a claim analysis on the document's current extraction and stores it as a new immutable record.
 * Failed provider calls are also recorded (status "failed") for auditability.
 */
export async function analyzeDocument(
  documentId: string,
  dependencies: AnalysisDependencies = defaultDependencies,
): Promise<Analysis> {
  const document = await documentRepository.findById(documentId);
  if (!document) throw new HttpError(404, 'Document not found.');

  const extraction = await extractionRepository.findCurrent(documentId);
  if (!extraction) throw new HttpError(409, 'The document has no extraction yet. Process it before analyzing.');
  if (!hasIdentity(extraction)) {
    throw new HttpError(409, 'The document only has a legacy extraction without source identity. Reprocess it before analyzing.');
  }

  const fragments = fragmentsOf(extraction);
  if (fragments.length === 0) throw new HttpError(409, 'The document extraction has no text to analyze.');
  const inputChars = fragments.reduce((sum, f) => sum + f.text.length, 0);
  if (inputChars > MAX_ANALYSIS_INPUT_CHARS) {
    throw new HttpError(422, `The document is too large for a single analysis (${inputChars} characters; limit ${MAX_ANALYSIS_INPUT_CHARS}).`);
  }

  let model: ClaimModel;
  try {
    model = dependencies.getModel();
  } catch (error) {
    if (error instanceof ClaimModelError && error.code === 'NOT_CONFIGURED') throw new HttpError(503, error.message);
    throw error;
  }

  const analysisId = randomUUID();
  const createdAt = new Date().toISOString();
  const base = {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    analysisId,
    documentId,
    extractionId: extraction.extractionId,
    sourceSha256: extraction.sourceSha256,
    extractorVersion: extraction.extractorVersion,
    promptVersion: PROMPT_VERSION,
    createdAt,
  };

  const fail = async (code: AnalysisErrorCode, message: string, cause: unknown, reportedModel = model.model): Promise<never> => {
    console.error(`[analysis] ${analysisId} for document ${documentId} failed (${code})`, cause);
    await analysisRepository.create({
      ...base,
      model: reportedModel,
      completedAt: new Date().toISOString(),
      status: 'failed',
      claims: [],
      rejectedClaims: [],
      contradictions: [],
      rejectedContradictions: [],
      documentationGaps: [],
      rejectedGaps: [],
      warnings: [],
      error: { code, message },
    });
    throw new HttpError(HTTP_STATUS_FOR[code], `${message} The failed attempt was recorded as analysis ${analysisId}.`);
  };

  let output;
  try {
    output = await model.extractClaims({ documentName: document.originalFilename, fragments });
  } catch (error) {
    const modelError =
      error instanceof ClaimModelError ? error : new ClaimModelError('PROVIDER_ERROR', 'The AI provider request failed.', { cause: error });
    const code = modelError.code === 'NOT_CONFIGURED' ? 'PROVIDER_ERROR' : modelError.code;
    return fail(code, modelError.message, modelError);
  }

  const evaluation = await evaluateAnalysis(output.data, extraction);
  if (!evaluation) {
    return fail('INVALID_RESPONSE', 'The AI provider returned a response that does not match the expected structure.', output.data, output.model);
  }

  const analysis: Analysis = {
    ...base,
    model: output.model,
    completedAt: new Date().toISOString(),
    status: 'completed',
    claims: evaluation.claims,
    rejectedClaims: evaluation.rejectedClaims,
    contradictions: evaluation.contradictions,
    rejectedContradictions: evaluation.rejectedContradictions,
    documentationGaps: evaluation.documentationGaps,
    rejectedGaps: evaluation.rejectedGaps,
    warnings: evaluation.warnings,
    error: null,
  };
  await analysisRepository.create(analysis);
  return analysis;
}

export async function getAnalysis(analysisId: string): Promise<Analysis> {
  if (!ANALYSIS_ID_PATTERN.test(analysisId)) throw new HttpError(400, 'Malformed analysis id.');
  const analysis = await analysisRepository.findById(analysisId);
  if (!analysis) throw new HttpError(404, 'Analysis not found.');
  return analysis;
}
