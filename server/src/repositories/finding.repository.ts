import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { FINDING_STATUSES, FINDING_TEXT_LIMIT, type FindingDecision } from '../types/finding.types.js';
import { createJsonExclusive } from './json-file.js';

export class FindingRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FindingRepositoryError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = ['schemaVersion', 'decisionId', 'analysisId', 'findingId', 'status', 'explanation', 'question', 'evidence', 'previousDecisionId', 'decidedAt'];

function validate(value: unknown, analysisId: string, decisionId?: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const d = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(d)) if (!FIELDS.includes(key)) errors.push(`unknown field "${key}"`);
  if (d.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  if (typeof d.decisionId !== 'string' || !UUID.test(d.decisionId) || (decisionId !== undefined && d.decisionId !== decisionId)) errors.push('"decisionId" must match its file name');
  if (d.analysisId !== analysisId) errors.push('"analysisId" must match its directory');
  if (typeof d.findingId !== 'string' || !d.findingId) errors.push('"findingId" must be a non-empty string');
  if (!FINDING_STATUSES.includes(d.status as never)) errors.push('"status" is invalid');
  const text = (v: unknown) => v === null || (typeof v === 'string' && v.trim().length > 0 && v.length <= FINDING_TEXT_LIMIT);
  if (!text(d.explanation) || !text(d.question)) errors.push('"explanation" and "question" must be null or non-empty text');
  const ev = d.evidence as Record<string, unknown> | null;
  if (d.status === 'resolved_with_evidence') {
    if (d.explanation === null) errors.push('a resolution needs an explanation');
    if (typeof ev !== 'object' || ev === null || typeof ev.sourceId !== 'string' || typeof ev.quote !== 'string' || !ev.quote) errors.push('a resolution needs verified evidence');
  } else if (ev !== null) {
    errors.push('only a resolution carries evidence');
  }
  if (d.status === 'pending_validation' && d.question === null) errors.push('a pending validation must state what is missing');
  if (d.previousDecisionId !== null && (typeof d.previousDecisionId !== 'string' || !UUID.test(d.previousDecisionId))) errors.push('"previousDecisionId" must be null or a UUID');
  if (typeof d.decidedAt !== 'string' || !ISO_8601.test(d.decidedAt)) errors.push('"decidedAt" must be ISO 8601');
  return errors;
}

/**
 * Append-only log of human decisions on the findings of one analysis. Records are immutable; each finding's
 * decisions form a single chain. An invalid record or broken chain makes the log unreadable (fail closed).
 */
export class FindingRepository {
  constructor(private readonly dir: string = storage.findingDecisionsDir) {}

  async create(decision: FindingDecision): Promise<void> {
    const errors = validate(decision, decision.analysisId);
    if (errors.length > 0) throw new FindingRepositoryError(`Refusing to store invalid finding decision: ${errors.join('; ')}`);
    const filePath = path.join(this.analysisDir(decision.analysisId), `${decision.decisionId}.json`);
    try {
      await createJsonExclusive(filePath, decision);
    } catch (error) {
      throw new FindingRepositoryError(`Failed to create finding decision "${filePath}"`, { cause: error });
    }
  }

  /** Decisions of an analysis grouped by finding, each list newest first. */
  async findByAnalysisId(analysisId: string): Promise<Map<string, FindingDecision[]>> {
    const dir = this.analysisDir(analysisId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw new FindingRepositoryError(`Failed to list finding decisions in "${dir}"`, { cause: error });
    }
    const byFinding = new Map<string, FindingDecision[]>();
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!UUID.test(id)) continue;
      const filePath = path.join(dir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8'));
      } catch (error) {
        throw new FindingRepositoryError(`Finding decision "${filePath}" is unreadable. The file was left unchanged.`, { cause: error });
      }
      const errors = validate(parsed, analysisId, id);
      if (errors.length > 0) throw new FindingRepositoryError(`Finding decision "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
      const d = parsed as FindingDecision;
      byFinding.set(d.findingId, [...(byFinding.get(d.findingId) ?? []), d]);
    }
    for (const [findingId, list] of byFinding) byFinding.set(findingId, this.chain(list, `${dir} (${findingId})`));
    return byFinding;
  }

  private chain(list: FindingDecision[], label: string): FindingDecision[] {
    const byPrevious = new Map<string | null, FindingDecision>();
    for (const d of list) {
      if (byPrevious.has(d.previousDecisionId)) throw new FindingRepositoryError(`Finding decisions "${label}" are inconsistent: two decisions replace the same one.`);
      byPrevious.set(d.previousDecisionId, d);
    }
    const ordered: FindingDecision[] = [];
    for (let current = byPrevious.get(null); current; current = byPrevious.get(current.decisionId)) ordered.push(current);
    if (ordered.length !== list.length) throw new FindingRepositoryError(`Finding decisions "${label}" do not form a single chain.`);
    return ordered.reverse();
  }

  private analysisDir(analysisId: string): string {
    if (!UUID.test(analysisId)) throw new FindingRepositoryError(`Invalid analysis id: ${JSON.stringify(analysisId)}`);
    return path.join(this.dir, analysisId);
  }
}

export const findingRepository = new FindingRepository();
