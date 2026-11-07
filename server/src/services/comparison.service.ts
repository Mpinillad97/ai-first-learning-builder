import { createHash } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import type { IdentifiedExtraction } from '../types/extraction.types.js';
import type { SourceLocator } from '../types/source.types.js';
import type {
  ChangeType,
  ComparedUnit,
  DiffSegment,
  DocumentChange,
  DocumentComparison,
  DocumentVersionView,
} from '../types/version.types.js';
import { buildSourceId } from './source.service.js';
import { listVersions, parseVersionNumber } from './version.service.js';

/**
 * Deterministic, text-only comparison of two versions' extracted units (PDF pages / DOCX paragraphs).
 * No AI is involved. See README "Version comparison" for the algorithm and its limits.
 */
export const COMPARISON_ALGORITHM = 'unit-lcs-v1';

/** Two removed/added units in the same changed region are reported as one "modified" unit at or above this. */
export const MODIFIED_SIMILARITY = 0.5;
/** Guards against quadratic blow-ups on very large documents (units) and very long units (words). */
const MAX_UNIT_CELLS = 25_000_000;
const MAX_WORD_CELLS = 4_000_000;

interface Unit {
  locator: SourceLocator;
  text: string;
  /** Whitespace-collapsed text used for equality. */
  key: string;
}

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();

function unitsOf(extraction: IdentifiedExtraction): { units: Unit[]; empty: number } {
  const raw =
    extraction.format === 'pdf'
      ? extraction.pages.map((p) => ({ locator: { type: 'pdf-page' as const, pageNumber: p.pageNumber }, text: p.text }))
      : extraction.paragraphs.map((p) => ({ locator: { type: 'docx-paragraph' as const, paragraphIndex: p.paragraphIndex }, text: p.text }));
  const units = raw.map((u) => ({ ...u, key: normalize(u.text) })).filter((u) => u.key.length > 0);
  return { units, empty: raw.length - units.length };
}

/** Longest common subsequence alignment of two sequences by key. Returns matched index pairs in order. */
function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length, m = b.length, width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1]! + 1 : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
  return pairs;
}

const words = (key: string): string[] => key.toLowerCase().split(' ');

/** Dice coefficient over word multisets: 2·|A∩B| / (|A|+|B|). 1 = same words, 0 = no shared word. */
export function similarity(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let shared = 0;
  for (const w of wb) {
    const c = counts.get(w) ?? 0;
    if (c > 0) {
      shared++;
      counts.set(w, c - 1);
    }
  }
  return (2 * shared) / (wa.length + wb.length);
}

/**
 * Within one changed region (removed units R, added units A, both in order), pairs units into "modified"
 * changes by an order-preserving alignment that maximizes total similarity, using only pairs at or above
 * MODIFIED_SIMILARITY. Ties are broken deterministically (earliest units first).
 */
function pairRegion(removed: Unit[], added: Unit[]): [number, number, number][] {
  const k = removed.length, l = added.length;
  if (k === 0 || l === 0) return [];
  const sim = removed.map((r) => added.map((a) => similarity(r.key, a.key)));
  const best: number[][] = Array.from({ length: k + 1 }, () => new Array<number>(l + 1).fill(0));
  for (let i = k - 1; i >= 0; i--) {
    for (let j = l - 1; j >= 0; j--) {
      const s = sim[i]![j]!;
      const take = s >= MODIFIED_SIMILARITY ? best[i + 1]![j + 1]! + s : -1;
      best[i]![j] = Math.max(take, best[i + 1]![j]!, best[i]![j + 1]!);
    }
  }
  const pairs: [number, number, number][] = [];
  let i = 0, j = 0;
  while (i < k && j < l) {
    const s = sim[i]![j]!;
    if (s >= MODIFIED_SIMILARITY && best[i]![j] === best[i + 1]![j + 1]! + s) {
      pairs.push([i, j, s]);
      i++;
      j++;
    } else if (best[i]![j] === best[i + 1]![j]) i++;
    else j++;
  }
  return pairs;
}

/** Word-level differences between two texts (whitespace kept as its own tokens). */
function wordDiff(before: string, after: string): DiffSegment[] | undefined {
  const a = before.split(/(\s+)/).filter(Boolean), b = after.split(/(\s+)/).filter(Boolean);
  if (a.length * b.length > MAX_WORD_CELLS) return undefined;
  const segments: DiffSegment[] = [];
  const push = (type: DiffSegment['type'], text: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === type) last.text += text;
    else segments.push({ type, text });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of lcsPairs(a, b)) {
    while (i < pi) push('removed', a[i++]!);
    while (j < pj) push('added', b[j++]!);
    push('equal', a[i]!);
    i++;
    j++;
  }
  while (i < a.length) push('removed', a[i++]!);
  while (j < b.length) push('added', b[j++]!);
  return segments;
}

function compareUnits(from: Unit[], to: Unit[]): { type: ChangeType; from?: Unit; to?: Unit; similarity?: number }[] {
  if (from.length * to.length > MAX_UNIT_CELLS) {
    throw new HttpError(422, `These versions are too large to compare (${from.length} x ${to.length} text units).`);
  }
  const result: { type: ChangeType; from?: Unit; to?: Unit; similarity?: number }[] = [];
  const emitRegion = (removed: Unit[], added: Unit[]) => {
    let r = 0, a = 0;
    for (const [pi, pj, s] of pairRegion(removed, added)) {
      while (r < pi) result.push({ type: 'removed', from: removed[r++]! });
      while (a < pj) result.push({ type: 'added', to: added[a++]! });
      result.push({ type: 'modified', from: removed[r++]!, to: added[a++]!, similarity: Math.round(s * 1000) / 1000 });
    }
    while (r < removed.length) result.push({ type: 'removed', from: removed[r++]! });
    while (a < added.length) result.push({ type: 'added', to: added[a++]! });
  };
  let i = 0, j = 0;
  for (const [pi, pj] of lcsPairs(from.map((u) => u.key), to.map((u) => u.key))) {
    emitRegion(from.slice(i, pi), to.slice(j, pj));
    result.push({ type: 'unchanged', from: from[pi]!, to: to[pj]! });
    i = pi + 1;
    j = pj + 1;
  }
  emitRegion(from.slice(i), to.slice(j));
  return result;
}

/** The version's current extraction, or a 409 explaining why it cannot be compared. */
async function comparableExtraction(v: DocumentVersionView): Promise<IdentifiedExtraction> {
  if (v.status === 'failed') throw new HttpError(409, `Processing of version ${v.version} failed; it has no extracted text to compare.`);
  if (v.status === 'processing') throw new HttpError(409, `Version ${v.version} is still being processed.`);
  if (v.status !== 'processed') throw new HttpError(409, `Version ${v.version} has not been processed yet; process it before comparing.`);
  const extraction = await extractionRepository.findCurrent(v.documentId);
  if (!extraction) throw new HttpError(409, `Version ${v.version} has no stored extraction; process it again before comparing.`);
  if (!extraction.extractionId || !extraction.sourceSha256 || !extraction.extractorVersion) {
    throw new HttpError(409, `Version ${v.version} only has a legacy extraction without identity, which cannot be cited; process it again before comparing.`);
  }
  // Re-read through the history lookup used by GET /api/sources/:sourceId, so every reference below resolves to this exact text.
  const listed = await extractionRepository.findInHistory(v.documentId, extraction.extractionId);
  if (!listed) throw new HttpError(409, `The extraction of version ${v.version} is not in its history; process it again before comparing.`);
  return listed.extraction;
}

export async function compareVersions(projectId: string, documentId: string, rawFrom: unknown, rawTo: unknown): Promise<DocumentComparison> {
  const fromNumber = parseVersionNumber(rawFrom, 'from');
  const toNumber = parseVersionNumber(rawTo, 'to');
  if (fromNumber === toNumber) throw new HttpError(400, '"from" and "to" must be different versions.');
  const history = await listVersions(projectId, documentId);
  const find = (n: number) => {
    const v = history.versions.find((x) => x.version === n);
    if (!v) throw new HttpError(404, `Version ${n} does not exist for this document.`);
    return v;
  };
  const fromVersion = find(fromNumber), toVersion = find(toNumber);
  const fromExtraction = await comparableExtraction(fromVersion);
  const toExtraction = await comparableExtraction(toVersion);
  if (fromExtraction.format !== toExtraction.format) {
    throw new HttpError(409, `Versions ${fromNumber} (${fromExtraction.format.toUpperCase()}) and ${toNumber} (${toExtraction.format.toUpperCase()}) have different formats; their pages and paragraphs cannot be compared unit by unit.`);
  }

  const a = unitsOf(fromExtraction), b = unitsOf(toExtraction);
  const side = (v: DocumentVersionView, e: IdentifiedExtraction, u: Unit): ComparedUnit => ({
    version: v.version,
    documentId: v.documentId,
    extractionId: e.extractionId,
    locator: u.locator,
    sourceId: buildSourceId(v.documentId, e.extractionId, u.locator),
    text: u.text,
  });
  const changes: DocumentChange[] = compareUnits(a.units, b.units).map((c) => {
    const from = c.from && side(fromVersion, fromExtraction, c.from);
    const to = c.to && side(toVersion, toExtraction, c.to);
    const changeId = `chg_${createHash('sha256')
      .update(JSON.stringify([COMPARISON_ALGORITHM, fromExtraction.extractionId, toExtraction.extractionId, c.type, from?.sourceId ?? null, to?.sourceId ?? null]))
      .digest('hex')
      .slice(0, 24)}`;
    const change: DocumentChange = { changeId, type: c.type };
    if (from) change.from = from;
    if (to) change.to = to;
    if (c.type === 'modified') {
      change.similarity = c.similarity!;
      const diff = wordDiff(from!.text, to!.text);
      if (diff) change.diff = diff;
    }
    return change;
  });

  const summary: Record<ChangeType, number> = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const c of changes) summary[c.type]++;
  const compared = (v: DocumentVersionView, e: IdentifiedExtraction, u: { units: Unit[]; empty: number }) => ({
    version: v.version,
    documentId: v.documentId,
    extractionId: e.extractionId,
    format: e.format,
    unitCount: u.units.length,
    emptyUnitCount: u.empty,
  });
  return {
    comparisonId: `cmp_${createHash('sha256').update(JSON.stringify([COMPARISON_ALGORITHM, fromExtraction.extractionId, toExtraction.extractionId])).digest('hex').slice(0, 24)}`,
    documentId: history.documentId,
    projectId,
    algorithm: COMPARISON_ALGORITHM,
    comparedAt: new Date().toISOString(),
    from: compared(fromVersion, fromExtraction, a),
    to: compared(toVersion, toExtraction, b),
    summary,
    changes,
  };
}
