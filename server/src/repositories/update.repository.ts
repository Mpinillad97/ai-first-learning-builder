import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import type { LearningUpdate } from '../types/update.types.js';
import { createJsonExclusive } from './json-file.js';

export class UpdateRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'UpdateRepositoryError';
  }
}

export const UPDATE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STRINGS = ['updateId', 'projectId', 'documentId', 'comparisonId', 'impactAnalysisId', 'sourceProposalId', 'rootProposalId', 'model', 'promptVersion', 'createdAt', 'completedAt'] as const;
const ARRAYS = ['operations', 'keptForReview', 'notUpdatedChanges', 'unchangedElementIds', 'rejectedOperations', 'warnings', 'validationErrors'] as const;

function validateStored(value: unknown, id: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const u = value as Record<string, unknown>;
  const errors: string[] = [];
  if (u.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  for (const f of STRINGS) if (typeof u[f] !== 'string' || u[f] === '') errors.push(`"${f}" must be a non-empty string`);
  if (u.updateId !== id) errors.push('"updateId" does not match its file name');
  for (const f of ARRAYS) if (!Array.isArray(u[f])) errors.push(`"${f}" must be an array`);
  for (const f of ['sourceProposalVersion', 'proposalVersion']) if (!Number.isInteger(u[f]) || (u[f] as number) < 1) errors.push(`"${f}" must be a positive integer`);
  if (Number.isInteger(u.sourceProposalVersion) && u.proposalVersion !== (u.sourceProposalVersion as number) + 1) errors.push('"proposalVersion" must follow "sourceProposalVersion"');
  if (u.status === 'completed') {
    if (typeof u.candidateProposalId !== 'string' || !u.candidateProposalId) errors.push('a completed update must reference its candidate proposal');
    if (Array.isArray(u.operations) && u.operations.length === 0) errors.push('a completed update must have operations');
    if (u.error !== null) errors.push('a completed update must not have an error');
  } else if (u.status === 'failed') {
    if (u.candidateProposalId !== null) errors.push('a failed update must not have a candidate proposal');
    if (typeof u.error !== 'object' || u.error === null) errors.push('a failed update must have an error');
  } else {
    errors.push('"status" must be "completed" or "failed"');
  }
  return errors;
}

/** One immutable JSON file per learning update. Never overwritten; a new update is always a new file. */
export class UpdateRepository {
  constructor(private readonly dir: string = storage.learningUpdatesDir) {}

  async create(update: LearningUpdate): Promise<void> {
    const errors = validateStored(update, update.updateId);
    if (errors.length > 0) throw new UpdateRepositoryError(`Refusing to store invalid learning update: ${errors.join('; ')}`);
    const filePath = this.pathFor(update.updateId);
    try {
      await createJsonExclusive(filePath, update);
    } catch (error) {
      throw new UpdateRepositoryError(`Failed to create learning update "${filePath}"`, { cause: error });
    }
  }

  async findById(id: string): Promise<LearningUpdate | null> {
    if (!UPDATE_ID_PATTERN.test(id)) return null;
    const filePath = this.pathFor(id);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new UpdateRepositoryError(`Failed to read learning update "${filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new UpdateRepositoryError(`Learning update "${filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    const errors = validateStored(parsed, id);
    if (errors.length > 0) throw new UpdateRepositoryError(`Learning update "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
    return parsed as LearningUpdate;
  }

  /** Every readable update. Invalid files are skipped and logged, never modified. */
  async findAll(): Promise<LearningUpdate[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new UpdateRepositoryError(`Failed to list learning updates in "${this.dir}"`, { cause: error });
    }
    const found: LearningUpdate[] = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!UPDATE_ID_PATTERN.test(id)) continue;
      try {
        const u = await this.findById(id);
        if (u) found.push(u);
      } catch (error) {
        console.error(`[updates] Skipping unreadable learning update ${id}`, error);
      }
    }
    return found;
  }

  private pathFor(id: string): string {
    if (!UPDATE_ID_PATTERN.test(id)) throw new UpdateRepositoryError(`Invalid learning update id: ${JSON.stringify(id)}`);
    return path.join(this.dir, `${id}.json`);
  }
}

export const updateRepository = new UpdateRepository();
