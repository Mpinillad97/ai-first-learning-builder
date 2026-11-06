import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { documentRepository } from '../repositories/document.repository.js';
import { PROJECT_ID_PATTERN, projectRepository } from '../repositories/project.repository.js';
import type { DocumentRecord } from '../types/document.types.js';
import { PROJECT_FIELD_LIMITS, REQUIRED_PROJECT_FIELDS, type Project, type ProjectInput } from '../types/project.types.js';
import { discardUploadedDocument, uploadDocument, type UploadedFile } from './document.service.js';

/** Validates a create-project request body. Returns trimmed input or a 400 with every problem listed. */
function parseProjectInput(body: unknown): ProjectInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'Invalid project: send a JSON object.');
  }
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (!(key in PROJECT_FIELD_LIMITS)) problems.push(`"${key}" is not an allowed field`);

  const input = {} as ProjectInput;
  const wrongType = new Set<string>();
  for (const field of Object.keys(PROJECT_FIELD_LIMITS) as (keyof ProjectInput)[]) {
    const raw = b[field];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      problems.push(`${field} must be text`);
      wrongType.add(field);
      input[field] = '';
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length > PROJECT_FIELD_LIMITS[field]) problems.push(`${field} must be at most ${PROJECT_FIELD_LIMITS[field]} characters`);
    input[field] = value;
  }
  for (const field of REQUIRED_PROJECT_FIELDS) if (!input[field] && !wrongType.has(field)) problems.push(`${field} is required`);

  if (problems.length > 0) throw new HttpError(400, `Invalid project: ${problems.join('; ')}.`);
  return input;
}

export async function createProject(body: unknown): Promise<Project> {
  const input = parseProjectInput(body);
  const now = new Date().toISOString();
  return projectRepository.create({ id: randomUUID(), ...input, documentIds: [], createdAt: now, updatedAt: now });
}

/** Newest first. */
export async function listProjects(): Promise<Project[]> {
  return (await projectRepository.findAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getProject(id: string): Promise<Project> {
  if (!PROJECT_ID_PATTERN.test(id)) throw new HttpError(400, 'Malformed project id.');
  const project = await projectRepository.findById(id);
  if (!project) throw new HttpError(404, 'Project not found.');
  return project;
}

/** The project's documents in upload order. Ids without a metadata record are skipped (and logged). */
export async function listProjectDocuments(projectId: string): Promise<DocumentRecord[]> {
  const project = await getProject(projectId);
  const documents: DocumentRecord[] = [];
  for (const id of project.documentIds) {
    const document = await documentRepository.findById(id);
    if (document) documents.push(document);
    else console.error(`[projects] Project ${projectId} references missing document ${id}`);
  }
  return documents;
}

/**
 * Uploads a document with the regular E2 upload (same validation, storage and metadata) and links it to the
 * project. If linking fails, the just-created document is discarded so no unassociated upload is left behind.
 * No processing is started.
 */
export async function uploadProjectDocument(projectId: string, file: UploadedFile): Promise<DocumentRecord> {
  await getProject(projectId);
  const document = await uploadDocument(file);
  let linked: Project | null;
  try {
    linked = await projectRepository.addDocument(projectId, document.id);
  } catch (error) {
    await discardUploadedDocument(document).catch((cleanupError: unknown) =>
      console.error(`[projects] Could not discard document ${document.id} after a failed link to ${projectId}`, cleanupError));
    throw error;
  }
  if (!linked) {
    await discardUploadedDocument(document);
    throw new HttpError(404, 'Project not found.');
  }
  return document;
}
