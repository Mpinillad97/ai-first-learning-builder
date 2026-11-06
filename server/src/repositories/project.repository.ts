import { readFile } from 'node:fs/promises';
import { storage } from '../config/storage.js';
import { PROJECT_FIELD_LIMITS, REQUIRED_PROJECT_FIELDS, type Project } from '../types/project.types.js';
import { writeJsonAtomic } from './json-file.js';

export class ProjectRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectRepositoryError';
  }
}

export const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = new Set(['id', 'name', 'product', 'audience', 'learningObjective', 'context', 'documentIds', 'createdAt', 'updatedAt']);

function validateProject(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const p = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(p)) if (!FIELDS.has(key)) errors.push(`unknown field "${key}"`);
  if (typeof p.id !== 'string' || !PROJECT_ID_PATTERN.test(p.id)) errors.push('"id" must be a UUID');
  for (const [field, max] of Object.entries(PROJECT_FIELD_LIMITS)) {
    const v = p[field];
    if (typeof v !== 'string' || v.length > max) errors.push(`"${field}" must be a string of at most ${max} characters`);
  }
  for (const field of REQUIRED_PROJECT_FIELDS) if (typeof p[field] !== 'string' || !(p[field] as string).trim()) errors.push(`"${field}" is required`);
  if (!Array.isArray(p.documentIds) || !p.documentIds.every((id) => typeof id === 'string' && id.length > 0) || new Set(p.documentIds).size !== p.documentIds.length) {
    errors.push('"documentIds" must be an array of unique ids');
  }
  for (const field of ['createdAt', 'updatedAt']) if (typeof p[field] !== 'string' || !ISO_8601.test(p[field] as string)) errors.push(`"${field}" must be ISO 8601`);
  return errors;
}

/**
 * Persists projects as a JSON array in one file (same conventions as DocumentRepository): operations are
 * serialized per instance, writes are atomic, and an invalid file is reported, never replaced.
 */
export class ProjectRepository {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string = storage.projectsFile) {}

  findAll(): Promise<Project[]> {
    return this.serialize(() => this.readAll());
  }

  findById(id: string): Promise<Project | null> {
    return this.serialize(async () => (await this.readAll()).find((p) => p.id === id) ?? null);
  }

  create(project: Project): Promise<Project> {
    return this.serialize(async () => {
      this.assertValid(project, 'create');
      const projects = await this.readAll();
      if (projects.some((p) => p.id === project.id)) throw new ProjectRepositoryError(`Project "${project.id}" already exists`);
      projects.push(project);
      await this.writeAll(projects);
      return project;
    });
  }

  /** Appends a document to a project. Returns null when the project does not exist. */
  addDocument(projectId: string, documentId: string): Promise<Project | null> {
    return this.serialize(async () => {
      const projects = await this.readAll();
      const index = projects.findIndex((p) => p.id === projectId);
      if (index === -1) return null;
      const current = projects[index]!;
      if (current.documentIds.includes(documentId)) return current;
      const updated: Project = { ...current, documentIds: [...current.documentIds, documentId], updatedAt: new Date().toISOString() };
      this.assertValid(updated, `add document to "${projectId}"`);
      projects[index] = updated;
      await this.writeAll(projects);
      return updated;
    });
  }

  private assertValid(project: unknown, context: string): void {
    const errors = validateProject(project);
    if (errors.length > 0) throw new ProjectRepositoryError(`Invalid project (${context}): ${errors.join('; ')}`);
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Missing file = no projects yet (nothing is written until the first project is created). */
  private async readAll(): Promise<Project[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ProjectRepositoryError(`Failed to read project store "${this.filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ProjectRepositoryError(`Project store "${this.filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    if (!Array.isArray(parsed)) throw new ProjectRepositoryError(`Project store "${this.filePath}" must contain a JSON array. The file was left unchanged.`);
    parsed.forEach((p, i) => this.assertValid(p, `record #${i} in "${this.filePath}"`));
    return parsed as Project[];
  }

  private async writeAll(projects: Project[]): Promise<void> {
    try {
      await writeJsonAtomic(this.filePath, projects);
    } catch (error) {
      throw new ProjectRepositoryError(`Failed to write project store "${this.filePath}"`, { cause: error });
    }
  }
}

export const projectRepository = new ProjectRepository();
