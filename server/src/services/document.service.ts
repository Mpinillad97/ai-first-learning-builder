import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { HttpError } from '../middleware/error.middleware.js';
import { documentRepository } from '../repositories/document.repository.js';
import type { DocumentRecord } from '../types/document.types.js';

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Accepted formats. Extension and MIME type must agree, and the first bytes must match the format's
 * signature. This is a shallow check: a ZIP signature does not prove a valid DOCX, nor "%PDF-" a
 * well-formed PDF. Full content validation happens when the document is parsed during extraction.
 */
const ACCEPTED_FORMATS: Record<string, { mimeType: string; signature: Buffer; label: string }> = {
  '.pdf': { mimeType: 'application/pdf', signature: Buffer.from('%PDF-', 'ascii'), label: 'PDF' },
  '.docx': { mimeType: DOCX_MIME, signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]), label: 'DOCX (ZIP)' },
};

/** Transport-neutral view of an uploaded file, so this service does not depend on the HTTP layer. */
export interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

const MAX_FILENAME_LENGTH = 255;

/** Keeps only the final path segment and strips control characters. Used for display metadata only. */
function sanitizeOriginalFilename(name: string): string {
  const baseName = name.split(/[/\\]/).pop() ?? '';
  const cleaned = baseName.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

function validateUpload(file: UploadedFile): { originalFilename: string; extension: string; mimeType: string } {
  const originalFilename = sanitizeOriginalFilename(file.originalName);
  if (!originalFilename) {
    throw new HttpError(400, 'The uploaded file must have a filename.');
  }

  const extension = path.extname(originalFilename).toLowerCase();
  const format = ACCEPTED_FORMATS[extension];
  if (!format) {
    throw new HttpError(415, 'Unsupported file type. Only .pdf and .docx files are accepted.');
  }

  const mimeType = file.mimeType.split(';')[0]!.trim().toLowerCase();
  if (mimeType !== format.mimeType) {
    throw new HttpError(
      415,
      `MIME type "${mimeType || 'none'}" does not match the ${extension} extension. Expected "${format.mimeType}".`,
    );
  }

  if (file.size === 0 || file.buffer.length === 0) {
    throw new HttpError(400, 'The uploaded file is empty.');
  }

  if (!file.buffer.subarray(0, format.signature.length).equals(format.signature)) {
    throw new HttpError(415, `File content does not match the ${extension} format (expected a ${format.label} file).`);
  }

  return { originalFilename, extension, mimeType };
}

/** Validates the upload, stores the original under a server-generated name and registers its metadata. */
export async function uploadDocument(file: UploadedFile): Promise<DocumentRecord> {
  const { originalFilename, extension, mimeType } = validateUpload(file);

  const id = randomUUID();
  const storedFilename = `${id}${extension}`;
  const absolutePath = path.join(storage.originalsDir, storedFilename);
  // storedFilename is generated here, but guard anyway: the target must sit directly in originalsDir.
  if (path.dirname(absolutePath) !== path.resolve(storage.originalsDir)) {
    throw new Error(`Refusing to write outside the originals directory: ${absolutePath}`);
  }

  // 'wx' fails if the file already exists, so an existing original is never overwritten.
  await writeFile(absolutePath, file.buffer, { flag: 'wx' });

  const now = new Date().toISOString();
  const record: DocumentRecord = {
    id,
    originalFilename,
    storedFilename,
    mimeType,
    extension,
    sizeBytes: file.buffer.length,
    storagePath: path.relative(storage.storageDir, absolutePath).split(path.sep).join('/'),
    status: 'uploaded',
    createdAt: now,
    updatedAt: now,
  };

  try {
    return await documentRepository.create(record);
  } catch (error) {
    // Remove only the file written by this request, so no orphan is left behind.
    try {
      await rm(absolutePath);
    } catch (cleanupError) {
      console.error(
        `[documents] Metadata persistence failed and the stored file "${storedFilename}" could not be removed.`,
        { persistenceError: error, cleanupError },
      );
    }
    throw error;
  }
}

/**
 * Compensation for a just-uploaded document whose follow-up step failed (e.g. linking it to a project):
 * removes its metadata record and its stored file. Never used for documents that were already in use.
 */
export async function discardUploadedDocument(document: DocumentRecord): Promise<void> {
  await documentRepository.delete(document.id);
  await rm(path.join(storage.storageDir, ...document.storagePath.split('/')), { force: true });
}

export function listDocuments(): Promise<DocumentRecord[]> {
  return documentRepository.findAll();
}

export async function getDocument(id: string): Promise<DocumentRecord> {
  const document = await documentRepository.findById(id);
  if (!document) {
    throw new HttpError(404, 'Document not found.');
  }
  return document;
}
