import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { extractDocx } from '../extractors/docx.extractor.js';
import { ExtractionError } from '../extractors/extraction-error.js';
import {
  buildFullText,
  computeExtractionId,
  EXTRACTOR_VERSIONS,
  identityUnits,
  sha256Hex,
} from '../extractors/extraction-identity.js';
import { extractPdf } from '../extractors/pdf.extractor.js';
import { HttpError } from '../middleware/error.middleware.js';
import { documentRepository } from '../repositories/document.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import type { DocumentRecord } from '../types/document.types.js';
import type { ExtractionFormat, ExtractionResult, IdentifiedExtraction } from '../types/extraction.types.js';

export type ProcessingSummary = {
  documentId: string;
  status: 'processed';
  format: ExtractionFormat;
  extractionId: string;
  /** True when identical content was already stored; the existing immutable extraction was reused. */
  reusedExisting: boolean;
  extractedAt: string;
  characterCount: number;
} & ({ pageCount: number; pagesWithText: number } | { paragraphCount: number });

const FORMAT_BY_EXTENSION: Record<string, ExtractionFormat> = { '.pdf': 'pdf', '.docx': 'docx' };

/** Documents being processed by this server process; guards against concurrent runs on one document. */
const inFlight = new Set<string>();

/** Resolves a record's relative storagePath and checks it stays inside the storage root. */
function resolveOriginalPath(document: DocumentRecord): string {
  const root = path.resolve(storage.storageDir);
  const absolute = path.resolve(root, document.storagePath);
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error(`Document ${document.id} has a storagePath outside the storage root`);
  }
  return absolute;
}

/** Runs the format's extractor and attaches identity metadata. Extractor output is used unchanged. */
async function extract(
  format: ExtractionFormat,
  buffer: Buffer,
  documentId: string,
  sourceSha256: string,
): Promise<IdentifiedExtraction> {
  const extractedAt = new Date().toISOString();
  const extractorVersion = EXTRACTOR_VERSIONS[format];
  const content =
    format === 'pdf'
      ? { format: 'pdf' as const, pages: await extractPdf(buffer) }
      : { format: 'docx' as const, paragraphs: await extractDocx(buffer) };
  const units = identityUnits(content);
  const extractionId = computeExtractionId(format, extractorVersion, sourceSha256, units);
  return {
    documentId,
    extractionId,
    sourceSha256,
    extractorVersion,
    extractedAt,
    fullText: buildFullText(units),
    ...content,
  };
}

function summarize(extraction: IdentifiedExtraction, reusedExisting: boolean): ProcessingSummary {
  const base = {
    documentId: extraction.documentId,
    status: 'processed' as const,
    format: extraction.format,
    extractionId: extraction.extractionId,
    reusedExisting,
    extractedAt: extraction.extractedAt,
    characterCount: extraction.fullText.length,
  };
  return extraction.format === 'pdf'
    ? { ...base, pageCount: extraction.pages.length, pagesWithText: extraction.pages.filter((p) => p.text).length }
    : { ...base, paragraphCount: extraction.paragraphs.length };
}

async function markFailed(documentId: string): Promise<void> {
  try {
    await documentRepository.update(documentId, { status: 'failed' });
  } catch (error) {
    console.error(`[processing] Could not set status "failed" on document ${documentId}`, error);
  }
}

async function run(document: DocumentRecord): Promise<ProcessingSummary> {
  const format = FORMAT_BY_EXTENSION[document.extension];
  if (!format) {
    await markFailed(document.id);
    throw new HttpError(422, `Text extraction is not supported for "${document.extension}" files.`);
  }

  // Fail early, before touching the status, if the stored history is inconsistent or corrupted.
  await extractionRepository.verifyHistory(document.id);

  let buffer: Buffer;
  try {
    buffer = await readFile(resolveOriginalPath(document));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    console.error(`[processing] Original file missing for document ${document.id}: ${document.storagePath}`);
    await markFailed(document.id);
    throw new HttpError(409, 'The original file for this document is missing, so it cannot be processed.');
  }

  const sourceSha256 = sha256Hex(buffer);

  await documentRepository.update(document.id, { status: 'processing' });
  try {
    const extraction = await extract(format, buffer, document.id, sourceSha256);
    // Reuses an identical stored extraction or creates a new immutable one, then updates the manifest.
    const { extraction: stored, reusedExisting } = await extractionRepository.record(extraction);
    await documentRepository.update(document.id, { status: 'processed' });
    return summarize(stored, reusedExisting);
  } catch (error) {
    await markFailed(document.id);
    if (error instanceof ExtractionError) {
      console.error(`[processing] Extraction failed for document ${document.id} (${error.code})`, error);
      throw new HttpError(422, error.message);
    }
    throw error;
  }
}

/** Extracts and stores the text of a document, moving its status uploaded/failed -> processing -> processed|failed. */
export async function processDocument(documentId: string): Promise<ProcessingSummary> {
  const document = await documentRepository.findById(documentId);
  if (!document) throw new HttpError(404, 'Document not found.');
  if (inFlight.has(documentId)) throw new HttpError(409, 'This document is already being processed.');

  inFlight.add(documentId);
  try {
    return await run(document);
  } finally {
    inFlight.delete(documentId);
  }
}

/** The document's current extraction (or its legacy extraction when no history exists yet). */
export async function getExtraction(documentId: string): Promise<ExtractionResult> {
  if (!(await documentRepository.findById(documentId))) throw new HttpError(404, 'Document not found.');
  const extraction = await extractionRepository.findCurrent(documentId);
  if (!extraction) throw new HttpError(404, 'No extraction exists for this document yet. Process it first.');
  return extraction;
}
