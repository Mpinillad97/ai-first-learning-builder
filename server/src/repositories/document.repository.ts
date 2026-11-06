import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { writeJsonAtomic } from './json-file.js';
import {
  DOCUMENT_STATUSES,
  type DocumentRecord,
  type DocumentStatus,
  type DocumentUpdate,
} from '../types/document.types.js';

export class DocumentRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DocumentRepositoryError';
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const STRING_FIELDS = [
  'id',
  'originalFilename',
  'storedFilename',
  'mimeType',
  'extension',
  'storagePath',
] as const;

const ALLOWED_FIELDS = new Set<string>([
  ...STRING_FIELDS,
  'sizeBytes',
  'status',
  'createdAt',
  'updatedAt',
]);

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_8601.test(value) || Number.isNaN(Date.parse(value))) {
    return false;
  }
  // Date.parse rolls impossible days over (e.g. Feb 30 -> Mar 2), so check the calendar date explicitly.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
}

function isDocumentStatus(value: unknown): value is DocumentStatus {
  return typeof value === 'string' && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/** Returns a list of problems; empty when the value is a valid DocumentRecord. */
function validateDocument(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['must be an object'];
  }
  const doc = value as Record<string, unknown>;
  const errors: string[] = [];

  for (const key of Object.keys(doc)) {
    if (!ALLOWED_FIELDS.has(key)) errors.push(`unknown field "${key}"`);
  }
  for (const field of STRING_FIELDS) {
    const v = doc[field];
    if (typeof v !== 'string' || v.trim() === '') errors.push(`"${field}" must be a non-empty string`);
  }
  if (typeof doc.sizeBytes !== 'number' || !Number.isInteger(doc.sizeBytes) || doc.sizeBytes <= 0) {
    errors.push('"sizeBytes" must be a positive integer');
  }
  if (!isDocumentStatus(doc.status)) {
    errors.push(`"status" must be one of: ${DOCUMENT_STATUSES.join(', ')}`);
  }
  for (const field of ['createdAt', 'updatedAt'] as const) {
    if (!isIsoDate(doc[field])) errors.push(`"${field}" must be an ISO 8601 date string`);
  }
  if (typeof doc.extension === 'string' && !/^\.[a-z0-9]+$/.test(doc.extension)) {
    errors.push('"extension" must be lowercase with a leading dot, e.g. ".pdf"');
  }
  if (typeof doc.storagePath === 'string') {
    const p = doc.storagePath;
    if (path.isAbsolute(p) || path.win32.isAbsolute(p) || p.includes('\\') || p.split('/').includes('..')) {
      errors.push('"storagePath" must be a relative POSIX path inside the storage root');
    }
  }
  return errors;
}

function assertValid(value: unknown, context: string): asserts value is DocumentRecord {
  const errors = validateDocument(value);
  if (errors.length > 0) {
    throw new DocumentRepositoryError(`Invalid document (${context}): ${errors.join('; ')}`);
  }
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * Persists document metadata as a JSON array in a single file.
 * Operations are serialized per instance so concurrent calls cannot lose each other's writes.
 * Original files are never touched by this repository.
 */
export class DocumentRepository {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(filePath: string = storage.documentsFile) {
    this.filePath = filePath;
  }

  findAll(): Promise<DocumentRecord[]> {
    return this.serialize(() => this.readAll());
  }

  findById(id: string): Promise<DocumentRecord | null> {
    return this.serialize(async () => {
      const documents = await this.readAll();
      return documents.find((doc) => doc.id === id) ?? null;
    });
  }

  create(document: DocumentRecord): Promise<DocumentRecord> {
    return this.serialize(async () => {
      assertValid(document, 'create');
      const documents = await this.readAll();
      if (documents.some((doc) => doc.id === document.id)) {
        throw new DocumentRepositoryError(`Document with id "${document.id}" already exists`);
      }
      const record = { ...document };
      documents.push(record);
      await this.writeAll(documents);
      return record;
    });
  }

  /** Applies `changes` and refreshes `updatedAt`. Returns null when the document does not exist. */
  update(id: string, changes: DocumentUpdate): Promise<DocumentRecord | null> {
    return this.serialize(async () => {
      const documents = await this.readAll();
      const index = documents.findIndex((doc) => doc.id === id);
      if (index === -1) return null;

      const current = documents[index]!;
      const updated: DocumentRecord = {
        ...current,
        ...changes,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: new Date().toISOString(),
      };
      assertValid(updated, `update "${id}"`);
      documents[index] = updated;
      await this.writeAll(documents);
      return updated;
    });
  }

  /** Removes the metadata record only. Returns false when the document does not exist. */
  delete(id: string): Promise<boolean> {
    return this.serialize(async () => {
      const documents = await this.readAll();
      const remaining = documents.filter((doc) => doc.id !== id);
      if (remaining.length === documents.length) return false;
      await this.writeAll(remaining);
      return true;
    });
  }

  // -- internals ------------------------------------------------------------

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async readAll(): Promise<DocumentRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.writeAll([]);
        return [];
      }
      throw new DocumentRepositoryError(`Failed to read document store "${this.filePath}"`, { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new DocumentRepositoryError(
        `Document store "${this.filePath}" contains invalid JSON. The file was left unchanged; fix or remove it manually.`,
        { cause: error },
      );
    }
    if (!Array.isArray(parsed)) {
      throw new DocumentRepositoryError(
        `Document store "${this.filePath}" must contain a JSON array. The file was left unchanged.`,
      );
    }
    parsed.forEach((doc, i) => assertValid(doc, `record #${i} in "${this.filePath}"`));
    return parsed as DocumentRecord[];
  }

  private async writeAll(documents: DocumentRecord[]): Promise<void> {
    try {
      await writeJsonAtomic(this.filePath, documents);
    } catch (error) {
      throw new DocumentRepositoryError(`Failed to write document store "${this.filePath}"`, { cause: error });
    }
  }
}

export const documentRepository = new DocumentRepository();
