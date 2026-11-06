import { randomUUID } from 'node:crypto';
import { readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import {
  buildFullText,
  computeExtractionId,
  EXTRACTION_ID_PATTERN,
  EXTRACTOR_VERSION_PATTERN,
  identityUnits,
  SHA256_PATTERN,
} from '../extractors/extraction-identity.js';
import type {
  ExtractionManifest,
  ExtractionResult,
  IdentifiedExtraction,
} from '../types/extraction.types.js';
import { createJsonExclusive, writeJsonAtomic } from './json-file.js';

/**
 * Storage layout (inside storage.extractionsDir):
 *
 *   <documentId>/manifest.json         mutable pointer: current extraction + ordered history
 *   <documentId>/<extractionId>.json   immutable, created once, never rewritten
 *   <documentId>.json                  legacy (pre-E2.4) flat file: read-only fallback
 *
 * If a document's history directory exists, its manifest is mandatory: a missing or invalid manifest is
 * a storage error and never falls back to the legacy file. The legacy file is only read when no history
 * directory exists, and it is never cited as a source.
 */
export class ExtractionRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractionRepositoryError';
  }
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const IDENTITY_FIELDS = ['extractionId', 'sourceSha256', 'extractorVersion'] as const;
const MANIFEST_FILE = 'manifest.json';
const NOT_CHANGED = 'The file was left unchanged.';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isTextUnit(value: unknown, key: 'pageNumber' | 'paragraphIndex'): value is Record<string, number | string> {
  if (typeof value !== 'object' || value === null) return false;
  const unit = value as Record<string, unknown>;
  return Number.isInteger(unit[key]) && typeof unit.text === 'string';
}

/** PDF pages are contiguous from 1; DOCX paragraph indexes are original positions, increasing but possibly with gaps. */
function isOrderedUnits(units: unknown, key: 'pageNumber' | 'paragraphIndex'): boolean {
  if (!Array.isArray(units)) return false;
  let previous = key === 'pageNumber' ? 0 : -1;
  for (const unit of units) {
    if (!isTextUnit(unit, key)) return false;
    const position = unit[key] as number;
    if (key === 'pageNumber' ? position !== previous + 1 : position <= previous) return false;
    previous = position;
  }
  return true;
}

/** Structural checks shared by legacy and identified extractions. */
function validateShape(value: unknown, documentId: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const e = value as Record<string, unknown>;
  const errors: string[] = [];
  if (e.documentId !== documentId) errors.push('"documentId" does not match the document it is stored under');
  if (typeof e.extractedAt !== 'string' || !ISO_8601.test(e.extractedAt)) errors.push('"extractedAt" must be ISO 8601');
  if (typeof e.fullText !== 'string') errors.push('"fullText" must be a string');
  if (e.format === 'pdf') {
    if (!isOrderedUnits(e.pages, 'pageNumber')) {
      errors.push('"pages" must be an ordered array of { pageNumber, text } numbered 1, 2, 3, ...');
    }
  } else if (e.format === 'docx') {
    if (!isOrderedUnits(e.paragraphs, 'paragraphIndex')) {
      errors.push('"paragraphs" must be an array of { paragraphIndex, text } with strictly increasing indexes >= 0');
    }
  } else {
    errors.push('"format" must be "pdf" or "docx"');
  }
  return errors;
}

function identityFieldCount(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  return IDENTITY_FIELDS.filter((field) => field in value).length;
}

/** Full validation of an identified extraction, including the recomputed identity. */
function validateIdentified(value: unknown, documentId: string, expectedExtractionId?: string): string[] {
  const errors = validateShape(value, documentId);
  const count = identityFieldCount(value);
  if (count !== IDENTITY_FIELDS.length) {
    errors.push(
      count === 0
        ? 'identity metadata (extractionId, sourceSha256, extractorVersion) is missing'
        : 'identity metadata is partially populated; extractionId, sourceSha256 and extractorVersion are all-or-none',
    );
    return errors;
  }
  const e = value as IdentifiedExtraction;
  if (typeof e.extractionId !== 'string' || !EXTRACTION_ID_PATTERN.test(e.extractionId)) {
    errors.push('"extractionId" must match ext_<32 lowercase hex>');
  }
  if (typeof e.sourceSha256 !== 'string' || !SHA256_PATTERN.test(e.sourceSha256)) {
    errors.push('"sourceSha256" must be 64 lowercase hex characters');
  }
  if (typeof e.extractorVersion !== 'string' || !EXTRACTOR_VERSION_PATTERN.test(e.extractorVersion)) {
    errors.push('"extractorVersion" must look like "pdf@1" or "docx@2"');
  } else if (e.extractorVersion.split('@')[0] !== e.format) {
    errors.push('"extractorVersion" does not match "format"');
  }
  if (expectedExtractionId !== undefined && e.extractionId !== expectedExtractionId) {
    errors.push(`"extractionId" does not match its file name (${expectedExtractionId}.json)`);
  }
  if (errors.length > 0) return errors; // identity cannot be recomputed from an invalid structure

  const units = identityUnits(e);
  if (e.fullText !== buildFullText(units)) errors.push('"fullText" does not match the stored units');
  if (computeExtractionId(e.format, e.extractorVersion, e.sourceSha256, units) !== e.extractionId) {
    errors.push('"extractionId" does not match the recomputed identity (content, version or source hash changed)');
  }
  return errors;
}

function validateLegacy(value: unknown, documentId: string): string[] {
  const errors = validateShape(value, documentId);
  const count = identityFieldCount(value);
  if (count > 0 && count < IDENTITY_FIELDS.length) {
    errors.push('identity metadata is partially populated; extractionId, sourceSha256 and extractorVersion are all-or-none');
  } else if (count === IDENTITY_FIELDS.length) {
    errors.push('identity metadata is not allowed in a legacy flat extraction file');
  }
  return errors;
}

function validateManifest(value: unknown, documentId: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const m = value as Record<string, unknown>;
  const errors: string[] = [];
  const allowed = new Set(['documentId', 'currentExtractionId', 'extractionIds']);
  for (const key of Object.keys(m)) if (!allowed.has(key)) errors.push(`unknown field "${key}"`);
  if (m.documentId !== documentId) errors.push('"documentId" does not match its directory');
  const ids = m.extractionIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    errors.push('"extractionIds" must be a non-empty array');
  } else {
    if (!ids.every((id) => typeof id === 'string' && EXTRACTION_ID_PATTERN.test(id))) {
      errors.push('"extractionIds" must contain only ext_<32 hex> ids');
    }
    if (new Set(ids).size !== ids.length) errors.push('"extractionIds" must not contain duplicates');
    if (!ids.includes(m.currentExtractionId)) errors.push('"currentExtractionId" must be listed in "extractionIds"');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

type HistoryState =
  | { kind: 'history'; manifest: ExtractionManifest }
  | { kind: 'legacy' }
  | { kind: 'none' };

export class ExtractionRepository {
  constructor(private readonly dir: string = storage.extractionsDir) {}

  /**
   * Reads and fully validates a document's history: the manifest and every extraction it lists.
   * Throws on any inconsistency. Used before processing changes anything.
   */
  async verifyHistory(documentId: string): Promise<void> {
    const state = await this.readState(documentId);
    if (state.kind !== 'history') return;
    for (const extractionId of state.manifest.extractionIds) {
      await this.readListedExtraction(documentId, extractionId);
    }
  }

  /** The document's current extraction (identified, or legacy when no history exists), or null. */
  async findCurrent(documentId: string): Promise<ExtractionResult | null> {
    const state = await this.readState(documentId);
    if (state.kind === 'history') {
      return this.readListedExtraction(documentId, state.manifest.currentExtractionId);
    }
    return state.kind === 'legacy' ? this.readLegacy(documentId) : null;
  }

  /**
   * A specific extraction from the document's history, current or historical.
   * Returns null when the document has no history or the manifest does not list the id.
   */
  async findInHistory(
    documentId: string,
    extractionId: string,
  ): Promise<{ extraction: IdentifiedExtraction; isCurrent: boolean } | null> {
    const state = await this.readState(documentId);
    if (state.kind !== 'history' || !state.manifest.extractionIds.includes(extractionId)) return null;
    const extraction = await this.readListedExtraction(documentId, extractionId);
    return { extraction, isCurrent: state.manifest.currentExtractionId === extractionId };
  }

  /**
   * Stores an identified extraction and makes it current. An existing valid extraction with the same id
   * is reused (never rewritten); a corrupted one blocks the operation. The immutable file is always written
   * before the manifest, so the manifest never lists a missing file.
   */
  async record(extraction: IdentifiedExtraction): Promise<{ extraction: IdentifiedExtraction; reusedExisting: boolean }> {
    const { documentId, extractionId } = extraction;
    const errors = validateIdentified(extraction, documentId);
    if (errors.length > 0) {
      throw new ExtractionRepositoryError(`Refusing to store invalid extraction: ${errors.join('; ')}`);
    }

    const state = await this.readState(documentId);
    if (state.kind !== 'history') {
      await this.createHistory(extraction);
      return { extraction, reusedExisting: false };
    }

    // Reuse a valid file with this id (listed, or left unlisted by an interrupted write); throws if corrupted.
    const existing = await this.readExtractionFile(documentId, extractionId);
    if (!existing) {
      const filePath = this.extractionPath(documentId, extractionId);
      try {
        await createJsonExclusive(filePath, extraction);
      } catch (error) {
        throw new ExtractionRepositoryError(`Failed to create extraction "${filePath}"`, { cause: error });
      }
    }

    const { manifest } = state;
    const next: ExtractionManifest = {
      documentId,
      currentExtractionId: extractionId,
      extractionIds: manifest.extractionIds.includes(extractionId)
        ? manifest.extractionIds
        : [...manifest.extractionIds, extractionId],
    };
    if (next.currentExtractionId !== manifest.currentExtractionId || next.extractionIds !== manifest.extractionIds) {
      const manifestPath = this.manifestPath(documentId);
      try {
        await writeJsonAtomic(manifestPath, next);
      } catch (error) {
        throw new ExtractionRepositoryError(`Failed to update manifest "${manifestPath}"`, { cause: error });
      }
    }
    return { extraction: existing ?? extraction, reusedExisting: existing !== null };
  }

  // -- internals ------------------------------------------------------------

  /**
   * First extraction of a document: builds the directory (extraction first, then manifest) under a
   * staging name and renames it into place, so a history directory never exists without its manifest.
   */
  private async createHistory(extraction: IdentifiedExtraction): Promise<void> {
    const { documentId, extractionId } = extraction;
    const historyDir = this.historyDir(documentId);
    // "." cannot appear in a document id, so staging directories are never mistaken for history.
    const stagingDir = path.join(this.dir, `${documentId}.staging-${randomUUID()}`);
    const manifest: ExtractionManifest = { documentId, currentExtractionId: extractionId, extractionIds: [extractionId] };
    try {
      await createJsonExclusive(path.join(stagingDir, `${extractionId}.json`), extraction);
      await writeJsonAtomic(path.join(stagingDir, MANIFEST_FILE), manifest);
      await rename(stagingDir, historyDir);
    } catch (error) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
      throw new ExtractionRepositoryError(`Failed to create extraction history "${historyDir}"`, { cause: error });
    }
  }

  private async readState(documentId: string): Promise<HistoryState> {
    const historyDir = this.historyDir(documentId);
    let isDirectory: boolean;
    try {
      isDirectory = (await stat(historyDir)).isDirectory();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ExtractionRepositoryError(`Failed to inspect "${historyDir}"`, { cause: error });
      }
      return (await this.exists(this.legacyPath(documentId))) ? { kind: 'legacy' } : { kind: 'none' };
    }
    if (!isDirectory) throw new ExtractionRepositoryError(`"${historyDir}" exists but is not a directory`);

    const manifestPath = this.manifestPath(documentId);
    const manifest = await this.readJson(manifestPath);
    if (manifest === undefined) {
      throw new ExtractionRepositoryError(
        `History directory "${historyDir}" exists but ${MANIFEST_FILE} is missing. Refusing to fall back to legacy data; restore the manifest manually.`,
      );
    }
    const errors = validateManifest(manifest, documentId);
    if (errors.length > 0) {
      throw new ExtractionRepositoryError(`Manifest "${manifestPath}" is invalid: ${errors.join('; ')}. ${NOT_CHANGED}`);
    }
    return { kind: 'history', manifest: manifest as ExtractionManifest };
  }

  /** Reads an extraction the manifest lists; a missing file is a storage error. */
  private async readListedExtraction(documentId: string, extractionId: string): Promise<IdentifiedExtraction> {
    const extraction = await this.readExtractionFile(documentId, extractionId);
    if (!extraction) {
      throw new ExtractionRepositoryError(
        `Manifest of document ${documentId} lists ${extractionId}, but "${this.extractionPath(documentId, extractionId)}" does not exist`,
      );
    }
    return extraction;
  }

  /** Reads and validates an immutable extraction file; null when it does not exist. */
  private async readExtractionFile(documentId: string, extractionId: string): Promise<IdentifiedExtraction | null> {
    const filePath = this.extractionPath(documentId, extractionId);
    const value = await this.readJson(filePath);
    if (value === undefined) return null;
    const errors = validateIdentified(value, documentId, extractionId);
    if (errors.length > 0) {
      throw new ExtractionRepositoryError(`Extraction "${filePath}" is invalid: ${errors.join('; ')}. ${NOT_CHANGED}`);
    }
    return value as IdentifiedExtraction;
  }

  private async readLegacy(documentId: string): Promise<ExtractionResult | null> {
    const filePath = this.legacyPath(documentId);
    const value = await this.readJson(filePath);
    if (value === undefined) return null;
    const errors = validateLegacy(value, documentId);
    if (errors.length > 0) {
      throw new ExtractionRepositoryError(`Legacy extraction "${filePath}" is invalid: ${errors.join('; ')}. ${NOT_CHANGED}`);
    }
    return value as ExtractionResult;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ExtractionRepositoryError(`Failed to inspect "${filePath}"`, { cause: error });
    }
  }

  /** Parsed JSON, or undefined when the file does not exist. Invalid JSON is an error, never replaced. */
  private async readJson(filePath: string): Promise<unknown> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ExtractionRepositoryError(`Failed to read "${filePath}"`, { cause: error });
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new ExtractionRepositoryError(
        `"${filePath}" contains invalid JSON. ${NOT_CHANGED} Fix or remove it manually.`,
        { cause: error },
      );
    }
  }

  private historyDir(documentId: string): string {
    if (!SAFE_ID.test(documentId)) {
      throw new ExtractionRepositoryError(`Invalid document id for extraction storage: ${JSON.stringify(documentId)}`);
    }
    return path.join(this.dir, documentId);
  }

  private manifestPath(documentId: string): string {
    return path.join(this.historyDir(documentId), MANIFEST_FILE);
  }

  private extractionPath(documentId: string, extractionId: string): string {
    if (!EXTRACTION_ID_PATTERN.test(extractionId)) {
      throw new ExtractionRepositoryError(`Invalid extraction id: ${JSON.stringify(extractionId)}`);
    }
    return path.join(this.historyDir(documentId), `${extractionId}.json`);
  }

  private legacyPath(documentId: string): string {
    return `${this.historyDir(documentId)}.json`;
  }
}

export const extractionRepository = new ExtractionRepository();
