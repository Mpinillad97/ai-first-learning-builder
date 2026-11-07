import { readFile } from 'node:fs/promises';
import { storage } from '../config/storage.js';
import type { DocumentRecord } from '../types/document.types.js';
import type { DocumentVersionHistory } from '../types/version.types.js';
import { writeJsonAtomic } from './json-file.js';
import { PROJECT_ID_PATTERN } from './project.repository.js';

export class VersionRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'VersionRepositoryError';
  }
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELDS = new Set(['documentId', 'projectId', 'versions', 'createdAt', 'updatedAt']);
const ENTRY_FIELDS = new Set(['version', 'documentId', 'originalFilename', 'uploadedAt']);

function validateHistory(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const h = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(h)) if (!FIELDS.has(key)) errors.push(`unknown field "${key}"`);
  if (typeof h.documentId !== 'string' || !SAFE_ID.test(h.documentId)) errors.push('"documentId" must be a document id');
  if (typeof h.projectId !== 'string' || !PROJECT_ID_PATTERN.test(h.projectId)) errors.push('"projectId" must be a UUID');
  for (const field of ['createdAt', 'updatedAt']) if (typeof h[field] !== 'string' || !ISO_8601.test(h[field] as string)) errors.push(`"${field}" must be ISO 8601`);
  if (!Array.isArray(h.versions) || h.versions.length < 2) {
    errors.push('"versions" must list at least two versions');
    return errors;
  }
  const seen = new Set<string>();
  h.versions.forEach((entry: unknown, i) => {
    const e = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    for (const key of Object.keys(e)) if (!ENTRY_FIELDS.has(key)) errors.push(`versions[${i}]: unknown field "${key}"`);
    if (e.version !== i + 1) errors.push(`versions[${i}].version must be ${i + 1}`);
    if (typeof e.documentId !== 'string' || !SAFE_ID.test(e.documentId) || seen.has(e.documentId)) errors.push(`versions[${i}].documentId must be a unique document id`);
    else seen.add(e.documentId);
    if (typeof e.originalFilename !== 'string' || !e.originalFilename) errors.push(`versions[${i}].originalFilename is required`);
    if (typeof e.uploadedAt !== 'string' || !ISO_8601.test(e.uploadedAt)) errors.push(`versions[${i}].uploadedAt must be ISO 8601`);
  });
  if ((h.versions[0] as Record<string, unknown> | undefined)?.documentId !== h.documentId) errors.push('versions[0] must be the logical document itself');
  return errors;
}

const entryFor = (version: number, document: DocumentRecord) => ({
  version,
  documentId: document.id,
  originalFilename: document.originalFilename,
  uploadedAt: document.createdAt,
});

/**
 * Persists version histories as a JSON array in one file (same conventions as the document and project
 * repositories): operations are serialized, writes are atomic, and an invalid file is reported, never
 * replaced. Entries are only ever appended; existing versions are never changed or removed.
 */
export class VersionRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = storage.documentVersionsFile) {}

  /** The stored history of a logical document, or null when it only has its original version. */
  find(documentId: string): Promise<DocumentVersionHistory | null> {
    return this.serialize(async () => (await this.readAll()).find((h) => h.documentId === documentId) ?? null);
  }

  /** The history containing `documentId` as a later version (2+), or null. */
  findContainingVersion(documentId: string): Promise<DocumentVersionHistory | null> {
    return this.serialize(async () => (await this.readAll()).find((h) => h.versions.slice(1).some((v) => v.documentId === documentId)) ?? null);
  }

  /**
   * Appends `newDocument` as the next version of `original`. The first append also records the original as
   * version 1. The version number is assigned inside the serialized operation, so concurrent uploads get
   * distinct, consecutive numbers.
   */
  appendVersion(projectId: string, original: DocumentRecord, newDocument: DocumentRecord): Promise<DocumentVersionHistory> {
    return this.serialize(async () => {
      const histories = await this.readAll();
      const index = histories.findIndex((h) => h.documentId === original.id);
      const now = new Date().toISOString();
      const current: DocumentVersionHistory =
        index === -1 ? { documentId: original.id, projectId, versions: [entryFor(1, original)], createdAt: now, updatedAt: now } : histories[index]!;
      if (current.projectId !== projectId) throw new VersionRepositoryError(`Document "${original.id}" belongs to another project's version history`);
      const updated: DocumentVersionHistory = {
        ...current,
        versions: [...current.versions, entryFor(current.versions.length + 1, newDocument)],
        updatedAt: now,
      };
      this.assertValid(updated, `append version to "${original.id}"`);
      if (index === -1) histories.push(updated);
      else histories[index] = updated;
      await this.writeAll(histories);
      return updated;
    });
  }

  private assertValid(history: unknown, context: string): void {
    const errors = validateHistory(history);
    if (errors.length > 0) throw new VersionRepositoryError(`Invalid version history (${context}): ${errors.join('; ')}`);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Missing file = no document has more than one version yet. */
  private async readAll(): Promise<DocumentVersionHistory[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new VersionRepositoryError(`Failed to read version store "${this.filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new VersionRepositoryError(`Version store "${this.filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    if (!Array.isArray(parsed)) throw new VersionRepositoryError(`Version store "${this.filePath}" must contain a JSON array. The file was left unchanged.`);
    parsed.forEach((h, i) => this.assertValid(h, `record #${i} in "${this.filePath}"`));
    const all = (parsed as DocumentVersionHistory[]).flatMap((h) => h.versions.map((v) => v.documentId));
    if (new Set(all).size !== all.length) throw new VersionRepositoryError(`Version store "${this.filePath}" lists a document in more than one version history. The file was left unchanged.`);
    return parsed as DocumentVersionHistory[];
  }

  private async writeAll(histories: DocumentVersionHistory[]): Promise<void> {
    try {
      await writeJsonAtomic(this.filePath, histories);
    } catch (error) {
      throw new VersionRepositoryError(`Failed to write version store "${this.filePath}"`, { cause: error });
    }
  }
}

export const versionRepository = new VersionRepository();
