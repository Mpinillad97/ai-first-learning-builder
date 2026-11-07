import { randomUUID } from 'node:crypto';
import { AUDIENCE_LABELS } from '../config/competency-profiles.js';
import { HttpError } from '../middleware/error.middleware.js';
import { ANALYSIS_ID_PATTERN, analysisRepository } from '../repositories/analysis.repository.js';
import { findingRepository } from '../repositories/finding.repository.js';
import { PROPOSAL_ID_PATTERN, proposalRepository } from '../repositories/proposal.repository.js';
import { trainingRepository } from '../repositories/training.repository.js';
import type { Analysis, ClaimEvidence } from '../types/analysis.types.js';
import { FINDING_STATUSES, FINDING_TEXT_LIMIT, type FindingDecision, type FindingStatus, type FindingType } from '../types/finding.types.js';
import type { LearningProposal, Module } from '../types/proposal.types.js';
import type { SourceLocator } from '../types/source.types.js';
import type { Audience } from '../types/training.types.js';
import { resolveSource } from './source.service.js';

/**
 * E5.5: human management of findings. Findings are derived (never copied or edited) from the analysis and the
 * proposal; decisions are an append-only log per finding. A decision is recorded as a human decision, distinct from
 * documentary evidence, and never changes a document, analysis, proposal or training: content changes go through
 * the existing generation and approval flows.
 */

export interface FindingReference { claimId: string | null; sourceId: string; locator: SourceLocator; quote: string; startOffset: number; endOffset: number }
export interface AffectedElement {
  scope: 'proposal' | 'training';
  ownerId: string;
  audience: Audience | null;
  ownerLabel: string;
  moduleTitle: string;
  elementId: string;
  elementType: 'lesson' | 'activity' | 'assessment' | 'product_knowledge';
  title: string;
}

export interface Finding {
  findingId: string;
  type: FindingType;
  origin: 'analysis' | 'proposal';
  title: string;
  description: string;
  severity: string | null;
  claims: { claimId: string; text: string; status: string }[];
  references: FindingReference[];
  status: FindingStatus;
  latestDecision: FindingDecision | null;
  /** Newest first. */
  decisions: FindingDecision[];
  /** Learning content that uses the claims involved (in the selected proposal and its latest trainings). */
  affected: AffectedElement[];
}

export interface FindingsView {
  analysisId: string;
  proposalId: string | null;
  counts: Record<FindingStatus, number> & { total: number; open: number };
  findings: Finding[];
}

const ref = (claimId: string | null, e: ClaimEvidence): FindingReference => ({ claimId, sourceId: e.sourceId, locator: e.locator, quote: e.quote, startOffset: e.startOffset, endOffset: e.endOffset });
const PROPOSAL_FINDING = /^proposal:([0-9a-f-]{36}):(wrn_\d+)$/;

/** Findings with their claim ids (used to locate affected content). */
function deriveFindings(analysis: Analysis, proposal: LearningProposal | null): (Omit<Finding, 'status' | 'latestDecision' | 'decisions' | 'affected'> & { claimIds: string[] })[] {
  const claims = new Map(analysis.claims.map((c) => [c.claimId, c]));
  const claimView = (ids: string[]) => ids.flatMap((id) => { const c = claims.get(id); return c ? [{ claimId: id, text: c.text, status: c.status }] : []; });
  const claimsCiting = (sourceIds: Set<string>) => analysis.claims.filter((c) => c.evidence.some((e) => sourceIds.has(e.sourceId))).map((c) => c.claimId);
  const out: ReturnType<typeof deriveFindings> = [];
  for (const c of analysis.contradictions ?? []) {
    const ids = [...new Set([...c.claimIds, ...claimsCiting(new Set(c.evidence.map((e) => e.sourceId)))])];
    out.push({ findingId: c.contradictionId, type: 'contradiction', origin: 'analysis', title: 'Contradicción en la documentación', description: c.description, severity: c.severity,
      claims: claimView(ids), references: c.evidence.map((e) => ref(null, e)), claimIds: ids });
  }
  for (const g of analysis.documentationGaps ?? []) {
    const ids = claimsCiting(new Set(g.relatedEvidence.map((e) => e.sourceId)));
    out.push({ findingId: g.gapId, type: 'documentation_gap', origin: 'analysis', title: `Información no documentada: ${g.topic}`, description: `${g.description} ${g.relevance}`.trim(), severity: null,
      claims: claimView(ids), references: g.relatedEvidence.map((e) => ref(null, e)), claimIds: ids });
  }
  for (const c of analysis.claims.filter((x) => x.status === 'pending_validation')) {
    out.push({ findingId: c.claimId, type: 'pending_validation', origin: 'analysis', title: 'Afirmación pendiente de validación', description: c.text, severity: null,
      claims: claimView([c.claimId]), references: c.evidence.map((e) => ref(c.claimId, e)), claimIds: [c.claimId] });
  }
  analysis.warnings.forEach((w, i) => out.push({ findingId: `awn_${i + 1}`, type: 'analysis_warning', origin: 'analysis', title: 'Advertencia del análisis', description: w, severity: null, claims: [], references: [], claimIds: [] }));
  for (const w of proposal?.warnings.filter((x) => x.type === 'proposal') ?? []) {
    const refs = proposal!.sourceReferences.filter((r) => w.relatedClaimIds.includes(r.claimId)).map((r) => ref(r.claimId, r));
    out.push({ findingId: `proposal:${proposal!.proposalId}:${w.warningId}`, type: 'proposal_warning', origin: 'proposal', title: 'Elemento de la propuesta que requiere revisión', description: w.message, severity: null,
      claims: claimView(w.relatedClaimIds), references: refs, claimIds: w.relatedClaimIds });
  }
  return out;
}

function affectedIn(modules: Module[], productKnowledge: { text: string; claimIds: string[] }[], claimIds: Set<string>, owner: Pick<AffectedElement, 'scope' | 'ownerId' | 'audience' | 'ownerLabel'>): AffectedElement[] {
  if (claimIds.size === 0) return [];
  const uses = (ids: string[]) => ids.some((id) => claimIds.has(id));
  const out: AffectedElement[] = [];
  productKnowledge.forEach((p, i) => { if (uses(p.claimIds)) out.push({ ...owner, moduleTitle: 'Conocimientos de producto', elementId: `pk_${i + 1}`, elementType: 'product_knowledge', title: p.text }); });
  for (const m of modules) {
    for (const l of m.lessons) if (uses(l.content.flatMap((c) => c.claimIds))) out.push({ ...owner, moduleTitle: m.title, elementId: l.lessonId, elementType: 'lesson', title: l.title });
    for (const a of m.activities) if (uses(a.claimIds)) out.push({ ...owner, moduleTitle: m.title, elementId: a.activityId, elementType: 'activity', title: a.title });
    for (const a of m.assessments) if (uses(a.claimIds)) out.push({ ...owner, moduleTitle: m.title, elementId: a.assessmentId, elementType: 'assessment', title: a.question });
  }
  return out;
}

async function loadContext(analysisId: string, proposalId: string | undefined) {
  if (!ANALYSIS_ID_PATTERN.test(analysisId)) throw new HttpError(400, 'Malformed analysis id.');
  const analysis = await analysisRepository.findById(analysisId);
  if (!analysis) throw new HttpError(404, 'Analysis not found.');
  if (analysis.status !== 'completed') throw new HttpError(409, 'This analysis failed and has no findings.');
  let proposal: LearningProposal | null = null;
  if (proposalId !== undefined) {
    if (!PROPOSAL_ID_PATTERN.test(proposalId)) throw new HttpError(400, 'Malformed proposal id.');
    proposal = await proposalRepository.findById(proposalId);
    if (!proposal || proposal.analysisId !== analysisId) throw new HttpError(404, 'Proposal not found for this analysis.');
  }
  return { analysis, proposal };
}

export async function listFindings(analysisId: string, query: Record<string, unknown>): Promise<FindingsView> {
  const proposalId = typeof query.proposalId === 'string' && query.proposalId ? query.proposalId : undefined;
  const { analysis, proposal } = await loadContext(analysisId, proposalId);
  const decisions = await findingRepository.findByAnalysisId(analysisId);
  const trainings = proposal
    ? (await trainingRepository.findAll()).filter((t) => t.proposalId === proposal.proposalId && t.status === 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const latestTrainings = trainings.filter((t, i) => trainings.findIndex((x) => x.audience === t.audience) === i);

  const findings: Finding[] = deriveFindings(analysis, proposal).map(({ claimIds, ...f }) => {
    const ids = new Set(claimIds);
    const history = decisions.get(f.findingId) ?? [];
    const affected = proposal?.content
      ? [
        ...affectedIn(proposal.content.modules, [], ids, { scope: 'proposal', ownerId: proposal.proposalId, audience: null, ownerLabel: 'Propuesta' }),
        ...latestTrainings.flatMap((t) => affectedIn(t.content!.modules, t.content!.productKnowledge, ids, { scope: 'training', ownerId: t.trainingId, audience: t.audience, ownerLabel: `Formación ${AUDIENCE_LABELS[t.audience]}` })),
      ]
      : [];
    return { ...f, status: history[0]?.status ?? 'unresolved', latestDecision: history[0] ?? null, decisions: history, affected };
  });
  const count = (s: FindingStatus) => findings.filter((f) => f.status === s).length;
  return {
    analysisId, proposalId: proposal?.proposalId ?? null,
    counts: { total: findings.length, open: count('unresolved') + count('pending_validation'), unresolved: count('unresolved'), pending_validation: count('pending_validation'), resolved_with_evidence: count('resolved_with_evidence') },
    findings,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------------------------------------------

const ALLOWED = ['status', 'explanation', 'question', 'evidence', 'basedOnDecisionId'];

async function parseDecisionBody(body: unknown) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Invalid decision: send a JSON object.');
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (!ALLOWED.includes(key)) problems.push(`"${key}" is not an allowed field`);
  if (!FINDING_STATUSES.includes(b.status as FindingStatus)) problems.push(`status must be one of: ${FINDING_STATUSES.join(', ')}`);
  const text = (field: string): string | null => {
    const v = b[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') { problems.push(`${field} must be text`); return null; }
    if (v.trim().length > FINDING_TEXT_LIMIT) problems.push(`${field} must be at most ${FINDING_TEXT_LIMIT} characters`);
    return v.trim() || null;
  };
  const explanation = text('explanation');
  const question = text('question');
  const status = b.status as FindingStatus;
  if (status === 'resolved_with_evidence' && !explanation) problems.push('a resolution requires an explanation of how it was resolved');
  if (status === 'pending_validation' && !question) problems.push('a pending validation requires the missing information or the question to resolve');
  if (status !== 'resolved_with_evidence' && b.evidence !== undefined && b.evidence !== null) problems.push('evidence is only recorded for resolved_with_evidence');
  if (!('basedOnDecisionId' in b) || (b.basedOnDecisionId !== null && typeof b.basedOnDecisionId !== 'string')) {
    problems.push('basedOnDecisionId is required (the id of the latest decision you saw, or null if there was none)');
  }
  let evidence: FindingDecision['evidence'] = null;
  if (status === 'resolved_with_evidence') {
    const ev = b.evidence as Record<string, unknown> | undefined | null;
    const quote = typeof ev?.quote === 'string' ? ev.quote.trim() : '';
    if (typeof ev !== 'object' || ev === null || typeof ev.sourceId !== 'string' || quote.length < 3) {
      problems.push('a resolution requires evidence: { sourceId, quote } citing authorized documentation (quote of at least 3 characters)');
    } else if (problems.length === 0) {
      try {
        const fragment = await resolveSource(ev.sourceId);
        if (!fragment.text.includes(quote)) problems.push('the evidence quote was not found verbatim in the cited source');
        else evidence = { sourceId: fragment.sourceId, locator: fragment.locator, quote };
      } catch (error) {
        if (error instanceof HttpError && error.status < 500) problems.push(`the evidence source cannot be resolved (${error.message})`);
        else throw error;
      }
    }
  }
  if (problems.length > 0) throw new HttpError(400, `Invalid decision: ${problems.join('; ')}.`);
  return { status, explanation, question, evidence, basedOnDecisionId: b.basedOnDecisionId as string | null };
}

const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return result;
}

/** Records a human decision on a finding (optimistic concurrency with basedOnDecisionId). */
export async function recordFindingDecision(analysisId: string, findingId: string, body: unknown): Promise<FindingDecision> {
  const proposalMatch = PROPOSAL_FINDING.exec(findingId);
  const { analysis, proposal } = await loadContext(analysisId, proposalMatch?.[1]);
  if (!deriveFindings(analysis, proposal).some((f) => f.findingId === findingId)) throw new HttpError(404, 'Finding not found for this analysis.');
  const input = await parseDecisionBody(body);
  return serialize(`${analysisId}:${findingId}`, async () => {
    const latest = (await findingRepository.findByAnalysisId(analysisId)).get(findingId)?.[0] ?? null;
    if ((latest?.decisionId ?? null) !== input.basedOnDecisionId) {
      throw new HttpError(409, 'Someone else recorded a decision on this finding in the meantime. Reload it before deciding.');
    }
    const decision: FindingDecision = {
      schemaVersion: 1, decisionId: randomUUID(), analysisId, findingId, status: input.status, explanation: input.explanation, question: input.question,
      evidence: input.evidence, previousDecisionId: latest?.decisionId ?? null, decidedAt: new Date().toISOString(),
    };
    await findingRepository.create(decision);
    return decision;
  });
}
