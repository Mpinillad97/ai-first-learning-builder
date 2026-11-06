import {
  CLAIM_STATUSES,
  CONTRADICTION_SEVERITIES,
  GAP_CATEGORIES,
  type ClaimStatus,
  type ContradictionSeverity,
  type GapCategory,
} from '../types/analysis.types.js';

/** Pure helpers for validating model output. No I/O. */

export const MAX_CLAIMS = 300;
export const MAX_CONTRADICTIONS = 50;
export const MAX_GAPS = 50;
export const MAX_EVIDENCE_PER_CLAIM = 10;
export const MAX_EVIDENCE_PER_CONTRADICTION = 10;
export const MAX_EVIDENCE_PER_GAP = 5;
export const MAX_TEXT_LENGTH = 2_000;

export interface ProposedEvidence {
  sourceId: string;
  quote: string;
}

export interface ProposedClaim {
  text: string;
  status: string;
  evidence: ProposedEvidence[];
  /** Structural problems found while reading this item; non-empty means rejected. */
  problems: string[];
}

export interface ProposedContradiction {
  description: string;
  severity: string;
  claimIndexes: number[];
  evidence: ProposedEvidence[];
  problems: string[];
}

export interface ProposedGap {
  topic: string;
  category: string;
  description: string;
  relevance: string;
  relatedEvidence: ProposedEvidence[];
  problems: string[];
}

export interface ProposedAnalysis {
  claims: ProposedClaim[];
  contradictions: ProposedContradiction[];
  gaps: ProposedGap[];
}

const truncate = (value: string): string => (value.length > MAX_TEXT_LENGTH ? `${value.slice(0, MAX_TEXT_LENGTH)}…` : value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return typeof value === 'string' && (CLAIM_STATUSES as readonly string[]).includes(value);
}
export function isContradictionSeverity(value: unknown): value is ContradictionSeverity {
  return typeof value === 'string' && (CONTRADICTION_SEVERITIES as readonly string[]).includes(value);
}
export function isGapCategory(value: unknown): value is GapCategory {
  return typeof value === 'string' && (GAP_CATEGORIES as readonly string[]).includes(value);
}

function unknownKeys(item: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(item)
    .filter((key) => !allowed.includes(key))
    .map((key) => `unexpected field "${key}"`);
}

function readText(item: Record<string, unknown>, field: string, problems: string[]): string {
  const value = typeof item[field] === 'string' ? (item[field] as string).trim() : '';
  if (!value) problems.push(`${field} is missing or empty`);
  else if (value.length > MAX_TEXT_LENGTH) problems.push(`${field} exceeds ${MAX_TEXT_LENGTH} characters`);
  return value;
}

/** Reads an evidence array. `min` is the minimum number of items required. */
function readEvidence(value: unknown, field: string, min: number, max: number, problems: string[]): ProposedEvidence[] {
  const evidence: ProposedEvidence[] = [];
  if (!Array.isArray(value)) {
    problems.push(`${field} must be an array`);
    return evidence;
  }
  if (value.length < min) problems.push(min === 1 ? 'at least one evidence item is required' : `${field} needs at least ${min} items`);
  if (value.length > max) {
    problems.push(`more than ${max} ${field} items`);
    return evidence;
  }
  for (const [i, ev] of value.entries()) {
    if (!isObject(ev) || typeof ev.sourceId !== 'string' || typeof ev.quote !== 'string') {
      problems.push(`${field} #${i + 1}: sourceId and quote must be strings`);
      continue;
    }
    evidence.push({ sourceId: ev.sourceId, quote: ev.quote });
  }
  return evidence;
}

function readClaim(item: unknown): ProposedClaim {
  if (!isObject(item)) return { text: '', status: '', evidence: [], problems: ['claim is not an object'] };
  const problems: string[] = [];
  const text = typeof item.text === 'string' ? item.text.trim() : '';
  if (!text) problems.push('claim text is missing or empty');
  if (text.length > MAX_TEXT_LENGTH) problems.push(`claim text exceeds ${MAX_TEXT_LENGTH} characters`);
  const status = typeof item.status === 'string' ? item.status : '';
  if (!isClaimStatus(status)) problems.push(`status must be one of: ${CLAIM_STATUSES.join(', ')}`);
  const evidence = readEvidence(item.evidence, 'evidence', 1, MAX_EVIDENCE_PER_CLAIM, problems);
  return { text, status, evidence, problems };
}

/**
 * E3.1 reader: { claims: [...] } only. Returns null when the top-level structure is unusable. Individual
 * malformed claims are returned with `problems` so they can be rejected one by one.
 */
export function readProposedClaims(data: unknown): ProposedClaim[] | null {
  if (!isObject(data) || !Array.isArray(data.claims) || Object.keys(data).some((k) => k !== 'claims')) return null;
  if (data.claims.length > MAX_CLAIMS) return null;
  return data.claims.map(readClaim);
}

function readContradiction(item: unknown): ProposedContradiction {
  const empty = { description: '', severity: '', claimIndexes: [], evidence: [] };
  if (!isObject(item)) return { ...empty, problems: ['contradiction is not an object'] };
  const problems = unknownKeys(item, ['description', 'severity', 'claimIndexes', 'evidence']);
  const description = readText(item, 'description', problems);
  const severity = typeof item.severity === 'string' ? item.severity : '';
  if (!isContradictionSeverity(severity)) problems.push(`severity must be one of: ${CONTRADICTION_SEVERITIES.join(', ')}`);
  const claimIndexes: number[] = [];
  if (!Array.isArray(item.claimIndexes)) {
    problems.push('claimIndexes must be an array');
  } else {
    for (const index of item.claimIndexes) {
      if (!Number.isInteger(index) || (index as number) < 0) problems.push(`claim index ${JSON.stringify(index)} is not a non-negative integer`);
      else if (claimIndexes.includes(index as number)) problems.push(`claim index ${index} is repeated`);
      else claimIndexes.push(index as number);
    }
  }
  const evidence = readEvidence(item.evidence, 'evidence', 2, MAX_EVIDENCE_PER_CONTRADICTION, problems);
  return { description, severity, claimIndexes, evidence, problems };
}

function readGap(item: unknown): ProposedGap {
  const empty = { topic: '', category: '', description: '', relevance: '', relatedEvidence: [] };
  if (!isObject(item)) return { ...empty, problems: ['gap is not an object'] };
  const problems = unknownKeys(item, ['topic', 'category', 'description', 'relevance', 'relatedEvidence']);
  const topic = readText(item, 'topic', problems);
  const description = readText(item, 'description', problems);
  const relevance = readText(item, 'relevance', problems);
  const category = typeof item.category === 'string' ? item.category : '';
  if (!isGapCategory(category)) problems.push(`category must be one of: ${GAP_CATEGORIES.join(', ')}`);
  const relatedEvidence = readEvidence(item.relatedEvidence, 'relatedEvidence', 0, MAX_EVIDENCE_PER_GAP, problems);
  return { topic, category, description, relevance, relatedEvidence, problems };
}

/**
 * E3.2 reader: exactly { claims, contradictions, gaps }, all arrays. Returns null when the top-level
 * structure is unusable (the whole response is invalid); individual items carry their own problems.
 */
export function readProposedAnalysis(data: unknown): ProposedAnalysis | null {
  if (!isObject(data)) return null;
  const keys = Object.keys(data).sort().join();
  if (keys !== 'claims,contradictions,gaps') return null;
  const { claims, contradictions, gaps } = data;
  if (!Array.isArray(claims) || !Array.isArray(contradictions) || !Array.isArray(gaps)) return null;
  if (claims.length > MAX_CLAIMS || contradictions.length > MAX_CONTRADICTIONS || gaps.length > MAX_GAPS) return null;
  return { claims: claims.map(readClaim), contradictions: contradictions.map(readContradiction), gaps: gaps.map(readGap) };
}

/** Bounded copy of a proposed claim for the audit record of rejected claims. */
export function toAuditCopy(claim: ProposedClaim): { text: string; status: string; evidence: ProposedEvidence[] } {
  return { text: truncate(claim.text), status: truncate(claim.status), evidence: auditEvidence(claim.evidence) };
}

export function auditEvidence(evidence: ProposedEvidence[]): ProposedEvidence[] {
  return evidence.map((e) => ({ sourceId: truncate(e.sourceId), quote: truncate(e.quote) }));
}

export const auditText = truncate;

// ---------------------------------------------------------------------------
// Quotations
// ---------------------------------------------------------------------------

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export type QuoteLocation = { ok: true; startOffset: number; endOffset: number } | { ok: false; reason: string };

/**
 * Locates `quote` as an exact substring of `text` and computes offsets in UTF-16 code units
 * (start inclusive, end exclusive). No normalization: accents, case and whitespace must match exactly.
 * Fails when the quote is empty, not found, or occurs more than once (ambiguous).
 */
export function locateQuote(text: string, quote: string): QuoteLocation {
  if (quote.trim().length === 0) return { ok: false, reason: 'quote is empty' };
  if (quote.length > MAX_TEXT_LENGTH) return { ok: false, reason: `quote exceeds ${MAX_TEXT_LENGTH} characters` };
  if (LONE_SURROGATE.test(quote)) return { ok: false, reason: 'quote is not well-formed Unicode' };

  const startOffset = text.indexOf(quote);
  if (startOffset === -1) return { ok: false, reason: 'quote does not appear verbatim in the source fragment' };
  if (text.indexOf(quote, startOffset + 1) !== -1) {
    return { ok: false, reason: 'quote occurs more than once in the source fragment (ambiguous)' };
  }

  const endOffset = startOffset + quote.length;
  const splitsPair =
    /[\uDC00-\uDFFF]/.test(text.charAt(startOffset)) || /[\uD800-\uDBFF]/.test(text.charAt(endOffset - 1));
  if (splitsPair || text.slice(startOffset, endOffset) !== quote) {
    return { ok: false, reason: 'quote boundaries do not align with the source text' };
  }
  return { ok: true, startOffset, endOffset };
}

/** True when two verified spans are different passages: different fragments, or non-overlapping ranges. */
export function areDistinctPassages(
  a: { sourceId: string; startOffset: number; endOffset: number },
  b: { sourceId: string; startOffset: number; endOffset: number },
): boolean {
  return a.sourceId !== b.sourceId || a.endOffset <= b.startOffset || b.endOffset <= a.startOffset;
}

// ---------------------------------------------------------------------------
// Product-truth guards (deterministic; they only ever make results more cautious)
// ---------------------------------------------------------------------------

/**
 * Capability statements that must never be asserted on the model's word alone: automatic reconciliation or
 * accounting changes, skipping user review, guaranteed matches.
 */
const RISKY_CAPABILITIES: { label: string; pattern: RegExp }[] = [
  { label: 'automation', pattern: /autom[aá]tic|\bautomat(?:ed|es|ion|ing)\b/i },
  {
    label: 'no user review',
    pattern:
      /\b(?:sin|no\s+(?:requiere|necesita|hace\s+falta))\b[^.]{0,40}\b(?:revisi[oó]n|revisar|validaci[oó]n|validar|intervenci[oó]n|aprobaci[oó]n)|\b(?:without|no\s+need\s+for|not\s+require|doesn'?t\s+require|no)\b[^.]{0,30}\b(?:review|validation|intervention|approval)\b/i,
  },
  { label: 'guarantee', pattern: /garantiz|\bguarantee|\b100\s?%|\bsiempre\s+(?:encuentra|concilia|acierta|coincide)|\balways\s+(?:finds?|match(?:es)?|reconcil\w*)/i },
];

/** Risky capability labels mentioned in a text. */
export function riskyCapabilities(text: string): string[] {
  return RISKY_CAPABILITIES.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label);
}

/** E3.1 guard, kept for compatibility: automation or skipping review. */
export function mentionsAutomationOrNoReview(claimText: string): boolean {
  return riskyCapabilities(claimText).some((label) => label === 'automation' || label === 'no user review');
}

/** Figures (numbers, percentages, amounts) in a text, as written. */
export function figuresIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0]);
}

/**
 * Claim-vs-evidence support check. Returns reasons why the claim says more than its quotations:
 * figures not present in any quote (unsupported_detail) and risky capabilities not stated by any quote
 * (overreach).
 */
export function unsupportedContent(
  claimText: string,
  quotes: string[],
  wording: { subject: string; evidence: string } = { subject: 'claim', evidence: 'its evidence' },
): { category: 'unsupported_detail' | 'overreach'; reason: string }[] {
  const joined = quotes.join('\n');
  const issues: { category: 'unsupported_detail' | 'overreach'; reason: string }[] = [];
  const quotedFigures = new Set(figuresIn(joined));
  for (const figure of new Set(figuresIn(claimText))) {
    if (!quotedFigures.has(figure)) {
      issues.push({ category: 'unsupported_detail', reason: `${wording.subject} states "${figure}", which does not appear in ${wording.evidence}` });
    }
  }
  const quotedRisks = new Set(riskyCapabilities(joined));
  for (const label of riskyCapabilities(claimText)) {
    if (!quotedRisks.has(label)) {
      issues.push({ category: 'overreach', reason: `${wording.subject} asserts ${label}, which is not stated by ${wording.evidence}` });
    }
  }
  return issues;
}

/**
 * Gaps describe missing documentation, never missing features. Detects descriptions that assert a capability
 * does not exist (e.g. "Fintaz does not support...", "no permite...").
 */
const ABSENCE_ASSERTION =
  /\b(?:fintaz|smart\s+reconciliation|it|the\s+(?:feature|product|system|tool)|el\s+(?:sistema|producto)|la\s+(?:funcionalidad|herramienta))\b[^.]{0,40}\b(?:does\s+not|doesn'?t|cannot|can'?t|is\s+not\s+able\s+to|lacks|no\s+(?:soporta|permite|ofrece|tiene|integra|admite|puede|cuenta\s+con))\b/i;

export function assertsAbsenceOfCapability(text: string): boolean {
  return ABSENCE_ASSERTION.test(text);
}

/** Contradiction descriptions must stay neutral; detects wording that sides with one statement. */
const RESOLUTION_WORDING =
  /\b(?:is\s+(?:correct|right|wrong|incorrect|outdated|accurate)|should\s+(?:be\s+)?(?:trust|prefer|follow|use)\w*|prevails?|takes\s+precedence|the\s+(?:newer|latest|correct|right)\s+(?:one|statement|version)|es\s+(?:la\s+)?(?:correct[ao]|incorrect[ao]|err[oó]ne[ao]|v[aá]lid[ao])|debe\s+prevalecer|m[aá]s\s+reciente|prevalece)\b/i;

export function favoursOneSide(description: string): boolean {
  return RESOLUTION_WORDING.test(description);
}
