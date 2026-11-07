import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import type { ImpactAnalysis } from '../types/impact.types.js';
import { createJsonExclusive } from './json-file.js';

export class ImpactRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ImpactRepositoryError';
  }
}

export const IMPACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STRINGS = ['impactAnalysisId', 'projectId', 'documentId', 'comparisonId', 'comparisonAlgorithm', 'proposalId', 'model', 'promptVersion', 'createdAt', 'completedAt'] as const;
const ARRAYS = ['results', 'affectedElements', 'rejectedResults', 'warnings', 'validationErrors'] as const;

function validateStored(value: unknown, id: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const a = value as Record<string, unknown>;
  const errors: string[] = [];
  if (a.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  for (const f of STRINGS) if (typeof a[f] !== 'string' || a[f] === '') errors.push(`"${f}" must be a non-empty string`);
  if (a.impactAnalysisId !== id) errors.push('"impactAnalysisId" does not match its file name');
  for (const f of ARRAYS) if (!Array.isArray(a[f])) errors.push(`"${f}" must be an array`);
  for (const f of ['from', 'to']) {
    const v = a[f] as Record<string, unknown> | null;
    if (typeof v !== 'object' || v === null || !Number.isInteger(v.version) || typeof v.documentId !== 'string' || typeof v.extractionId !== 'string') errors.push(`"${f}" must be a version reference`);
  }
  if (a.status === 'completed') {
    if (a.error !== null) errors.push('a completed analysis must not have an error');
  } else if (a.status === 'failed') {
    if (Array.isArray(a.results) && a.results.length > 0) errors.push('a failed analysis must not have results');
    if (typeof a.error !== 'object' || a.error === null) errors.push('a failed analysis must have an error');
  } else {
    errors.push('"status" must be "completed" or "failed"');
  }
  return errors;
}

/** One immutable JSON file per impact analysis. Never overwritten; a new analysis is always a new file. */
export class ImpactRepository {
  constructor(private readonly dir: string = storage.impactAnalysesDir) {}

  async create(analysis: ImpactAnalysis): Promise<void> {
    const errors = validateStored(analysis, analysis.impactAnalysisId);
    if (errors.length > 0) throw new ImpactRepositoryError(`Refusing to store invalid impact analysis: ${errors.join('; ')}`);
    const filePath = this.pathFor(analysis.impactAnalysisId);
    try {
      await createJsonExclusive(filePath, analysis);
    } catch (error) {
      throw new ImpactRepositoryError(`Failed to create impact analysis "${filePath}"`, { cause: error });
    }
  }

  /** Null for unknown ids. Throws on unreadable or corrupted files (left unchanged). */
  async findById(id: string): Promise<ImpactAnalysis | null> {
    if (!IMPACT_ID_PATTERN.test(id)) return null;
    const filePath = this.pathFor(id);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ImpactRepositoryError(`Failed to read impact analysis "${filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ImpactRepositoryError(`Impact analysis "${filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    const errors = validateStored(parsed, id);
    if (errors.length > 0) throw new ImpactRepositoryError(`Impact analysis "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
    return parsed as ImpactAnalysis;
  }

  /** Every readable impact analysis of a logical document. Invalid files are skipped and logged, never modified. */
  async findByDocumentId(documentId: string): Promise<ImpactAnalysis[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ImpactRepositoryError(`Failed to list impact analyses in "${this.dir}"`, { cause: error });
    }
    const found: ImpactAnalysis[] = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!IMPACT_ID_PATTERN.test(id)) continue;
      try {
        const a = await this.findById(id);
        if (a?.documentId === documentId) found.push(a);
      } catch (error) {
        console.error(`[impact] Skipping unreadable impact analysis ${id}`, error);
      }
    }
    return found;
  }

  private pathFor(id: string): string {
    if (!IMPACT_ID_PATTERN.test(id)) throw new ImpactRepositoryError(`Invalid impact analysis id: ${JSON.stringify(id)}`);
    return path.join(this.dir, `${id}.json`);
  }
}

export const impactRepository = new ImpactRepository();
