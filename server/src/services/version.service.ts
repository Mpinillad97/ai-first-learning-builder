import { HttpError } from '../middleware/error.middleware.js';
import { documentRepository } from '../repositories/document.repository.js';
import { versionRepository } from '../repositories/version.repository.js';
import type { DocumentRecord } from '../types/document.types.js';
import type { DocumentVersionEntry, DocumentVersionsView, DocumentVersionView } from '../types/version.types.js';
import { discardUploadedDocument, uploadDocument, type UploadedFile } from './document.service.js';
import { getProject } from './project.service.js';

/** A logical document of a project: its original record (version 1) and its version entries, oldest first. */
interface LogicalDocument {
  projectId: string;
  original: DocumentRecord;
  entries: DocumentVersionEntry[];
}

/**
 * Resolves a logical document inside a project. Only documents uploaded to the project (its documentIds,
 * i.e. version 1 of each logical document) are accepted, so a document can never be versioned or compared
 * through another project or through one of its later versions.
 */
export async function getLogicalDocument(projectId: string, documentId: string): Promise<LogicalDocument> {
  const project = await getProject(projectId);
  if (!project.documentIds.includes(documentId)) {
    const owner = await versionRepository.findContainingVersion(documentId);
    if (owner && owner.projectId === projectId) {
      const version = owner.versions.find((v) => v.documentId === documentId)!.version;
      throw new HttpError(400, `This document is version ${version} of document ${owner.documentId}. Use the logical document id (version 1).`);
    }
    throw new HttpError(404, 'Document not found in this project.');
  }
  const original = await documentRepository.findById(documentId);
  if (!original) throw new HttpError(404, 'Document not found.');
  const history = await versionRepository.find(documentId);
  if (history && history.projectId !== projectId) throw new Error(`Version history of ${documentId} belongs to project ${history.projectId}, not ${projectId}`);
  const entries = history?.versions ?? [{ version: 1, documentId: original.id, originalFilename: original.originalFilename, uploadedAt: original.createdAt }];
  return { projectId, original, entries };
}

async function toView(logical: LogicalDocument): Promise<DocumentVersionsView> {
  const currentVersion = logical.entries.length;
  const versions: DocumentVersionView[] = [];
  for (const entry of logical.entries) {
    const document = entry.documentId === logical.original.id ? logical.original : await documentRepository.findById(entry.documentId);
    if (!document) throw new Error(`Version ${entry.version} of ${logical.original.id} references missing document ${entry.documentId}`);
    versions.push({ ...entry, status: document.status, isCurrent: entry.version === currentVersion, document });
  }
  return { documentId: logical.original.id, projectId: logical.projectId, currentVersion, versions };
}

export async function listVersions(projectId: string, documentId: string): Promise<DocumentVersionsView> {
  return toView(await getLogicalDocument(projectId, documentId));
}

export function parseVersionNumber(raw: unknown, name = 'version'): number {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,5}$/.test(raw)) throw new HttpError(400, `"${name}" must be a version number (1, 2, 3, ...).`);
  return Number(raw);
}

export async function getVersion(projectId: string, documentId: string, rawVersion: string): Promise<DocumentVersionView> {
  const version = parseVersionNumber(rawVersion);
  const view = await listVersions(projectId, documentId);
  const found = view.versions.find((v) => v.version === version);
  if (!found) throw new HttpError(404, `Version ${version} does not exist for this document.`);
  return found;
}

/**
 * Uploads a new version with the regular E2 upload (same validation, storage and metadata) and appends it
 * to the logical document's history. Earlier versions, their files and extractions are never touched.
 * Processing is not started here: the client runs the existing POST /api/documents/:id/process.
 */
export async function uploadVersion(projectId: string, documentId: string, file: UploadedFile): Promise<DocumentVersionView> {
  const logical = await getLogicalDocument(projectId, documentId);
  const document = await uploadDocument(file);
  try {
    await versionRepository.appendVersion(projectId, logical.original, document);
  } catch (error) {
    await discardUploadedDocument(document).catch((cleanupError: unknown) =>
      console.error(`[versions] Could not discard document ${document.id} after a failed version append to ${documentId}`, cleanupError));
    throw error;
  }
  const view = await listVersions(projectId, documentId);
  return view.versions.find((v) => v.documentId === document.id)!;
}
