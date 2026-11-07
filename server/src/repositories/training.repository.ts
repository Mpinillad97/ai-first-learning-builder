import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { AUDIENCES, type AudienceTraining } from '../types/training.types.js';
import { createJsonExclusive } from './json-file.js';

export class TrainingRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TrainingRepositoryError';
  }
}

export const TRAINING_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const STRINGS = ['trainingId', 'proposalId', 'analysisId', 'documentId', 'extractionId', 'sourceSha256', 'profileVersion', 'model', 'promptVersion', 'createdAt', 'completedAt'] as const;
const ARRAYS = ['sourceReferences', 'warnings', 'rejectedItems', 'validationErrors'] as const;

function validateStored(value: unknown, id: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const t = value as Record<string, unknown>;
  const errors: string[] = [];
  if (t.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  for (const f of STRINGS) if (typeof t[f] !== 'string' || t[f] === '') errors.push(`"${f}" must be a non-empty string`);
  if (t.trainingId !== id) errors.push('"trainingId" does not match its file name');
  if (!AUDIENCES.includes(t.audience as never)) errors.push(`"audience" must be one of: ${AUDIENCES.join(', ')}`);
  for (const f of ARRAYS) if (!Array.isArray(t[f])) errors.push(`"${f}" must be an array`);
  const lineage = t.lineage as Record<string, unknown> | null | undefined;
  if (typeof lineage !== 'object' || lineage === null || typeof lineage.rootProposalId !== 'string' || !Number.isInteger(lineage.proposalVersion)
    || !Number.isInteger(lineage.trainingVersion) || (lineage.previousTrainingId !== null && typeof lineage.previousTrainingId !== 'string')) {
    errors.push('"lineage" is invalid');
  }
  if (t.status === 'draft') {
    if (typeof t.content !== 'object' || t.content === null) errors.push('a draft must have content');
    if (t.error !== null) errors.push('a draft must not have an error');
  } else if (t.status === 'failed') {
    if (t.content !== null) errors.push('a failed attempt must not have content');
    if (typeof t.error !== 'object' || t.error === null) errors.push('a failed attempt must have an error');
  } else {
    errors.push('"status" must be "draft" or "failed"');
  }
  return errors;
}

/** One immutable JSON file per audience training (including failed attempts). Never overwritten. */
export class TrainingRepository {
  constructor(private readonly dir: string = storage.trainingsDir) {}

  async create(training: AudienceTraining): Promise<void> {
    const errors = validateStored(training, training.trainingId);
    if (errors.length > 0) throw new TrainingRepositoryError(`Refusing to store invalid training: ${errors.join('; ')}`);
    const filePath = this.pathFor(training.trainingId);
    try {
      await createJsonExclusive(filePath, training);
    } catch (error) {
      throw new TrainingRepositoryError(`Failed to create training "${filePath}"`, { cause: error });
    }
  }

  async findById(id: string): Promise<AudienceTraining | null> {
    if (!TRAINING_ID_PATTERN.test(id)) return null;
    const filePath = this.pathFor(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new TrainingRepositoryError(`Training "${filePath}" is unreadable or contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    const errors = validateStored(parsed, id);
    if (errors.length > 0) throw new TrainingRepositoryError(`Training "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
    return parsed as AudienceTraining;
  }

  /** Every readable training. Invalid files are skipped and logged, never modified. */
  async findAll(): Promise<AudienceTraining[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new TrainingRepositoryError(`Failed to list trainings in "${this.dir}"`, { cause: error });
    }
    const found: AudienceTraining[] = [];
    for (const name of names) {
      const id = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!TRAINING_ID_PATTERN.test(id)) continue;
      try {
        const t = await this.findById(id);
        if (t) found.push(t);
      } catch (error) {
        console.error(`[trainings] Skipping unreadable training ${id}`, error);
      }
    }
    return found;
  }

  private pathFor(id: string): string {
    if (!TRAINING_ID_PATTERN.test(id)) throw new TrainingRepositoryError(`Invalid training id: ${JSON.stringify(id)}`);
    return path.join(this.dir, `${id}.json`);
  }
}

export const trainingRepository = new TrainingRepository();
