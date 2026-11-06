import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import type { Analysis } from '../types/analysis.types.js';
import { createJsonExclusive } from './json-file.js';

export class AnalysisRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AnalysisRepositoryError';
  }
}

export const ANALYSIS_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REQUIRED_STRINGS = ['analysisId', 'documentId', 'extractionId', 'sourceSha256', 'extractorVersion', 'model', 'promptVersion', 'createdAt', 'completedAt'] as const;

/** Light structural check on read; full validation happens before an analysis is created. */
function validateStored(value: unknown, analysisId: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const a = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const field of REQUIRED_STRINGS) if (typeof a[field] !== 'string' || a[field] === '') errors.push(`"${field}" must be a non-empty string`);
  if (a.analysisId !== analysisId) errors.push('"analysisId" does not match its file name');
  if (a.status !== 'completed' && a.status !== 'failed') errors.push('"status" must be "completed" or "failed"');
  for (const field of ['claims', 'rejectedClaims', 'warnings'] as const) if (!Array.isArray(a[field])) errors.push(`"${field}" must be an array`);
  if (a.status === 'failed' ? typeof a.error !== 'object' || a.error === null : a.error !== null) {
    errors.push('"error" must be set exactly when status is "failed"');
  }

  // Version 1 (E3.1) files have no schemaVersion and none of the v2 collections; they are returned as stored.
  if (!('schemaVersion' in a)) {
    for (const field of V2_FIELDS) if (field in a) errors.push(`"${field}" requires "schemaVersion": 2`);
    return errors;
  }
  if (a.schemaVersion !== 2) errors.push('"schemaVersion" must be 2');
  for (const field of V2_FIELDS) if (!Array.isArray(a[field])) errors.push(`"${field}" must be an array`);
  if (Array.isArray(a.contradictions) && !a.contradictions.every((c) => (c as { status?: unknown })?.status === 'pending_review')) {
    errors.push('every contradiction must have status "pending_review"');
  }
  if (Array.isArray(a.documentationGaps) && !a.documentationGaps.every((g) => (g as { status?: unknown })?.status === 'not_documented')) {
    errors.push('every documentation gap must have status "not_documented"');
  }
  return errors;
}

const V2_FIELDS = ['contradictions', 'rejectedContradictions', 'documentationGaps', 'rejectedGaps'] as const;

/** One immutable JSON file per analysis: <analysesDir>/<analysisId>.json. Existing analyses are never overwritten. */
export class AnalysisRepository {
  constructor(private readonly dir: string = storage.analysesDir) {}

  async create(analysis: Analysis): Promise<void> {
    const filePath = this.pathFor(analysis.analysisId);
    const errors = validateStored(analysis, analysis.analysisId);
    if (errors.length > 0) throw new AnalysisRepositoryError(`Refusing to store invalid analysis: ${errors.join('; ')}`);
    try {
      await createJsonExclusive(filePath, analysis);
    } catch (error) {
      throw new AnalysisRepositoryError(`Failed to create analysis "${filePath}"`, { cause: error });
    }
  }

  /** Returns null for unknown ids. Throws on unreadable or corrupted files (left unchanged). */
  async findById(analysisId: string): Promise<Analysis | null> {
    if (!ANALYSIS_ID_PATTERN.test(analysisId)) return null;
    const filePath = this.pathFor(analysisId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AnalysisRepositoryError(`Failed to read analysis "${filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new AnalysisRepositoryError(`Analysis "${filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    const errors = validateStored(parsed, analysisId);
    if (errors.length > 0) {
      throw new AnalysisRepositoryError(`Analysis "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
    }
    return parsed as Analysis;
  }

  private pathFor(analysisId: string): string {
    if (!ANALYSIS_ID_PATTERN.test(analysisId)) {
      throw new AnalysisRepositoryError(`Invalid analysis id: ${JSON.stringify(analysisId)}`);
    }
    return path.join(this.dir, `${analysisId}.json`);
  }
}

export const analysisRepository = new AnalysisRepository();
