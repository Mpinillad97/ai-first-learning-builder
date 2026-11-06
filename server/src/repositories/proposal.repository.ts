import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import type { LearningProposal } from '../types/proposal.types.js';
import { createJsonExclusive } from './json-file.js';

export class ProposalRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProposalRepositoryError';
  }
}

export const PROPOSAL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const REQUIRED_STRINGS = ['proposalId', 'analysisId', 'documentId', 'extractionId', 'sourceSha256', 'model', 'promptVersion', 'createdAt', 'completedAt'] as const;
const ARRAYS = ['sourceReferences', 'warnings', 'rejectedItems', 'validationErrors'] as const;

/** Structural and integrity check (on create and on read). */
function validateStored(value: unknown, proposalId: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const p = value as Record<string, unknown>;
  const errors: string[] = [];
  if (p.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  for (const field of REQUIRED_STRINGS) if (typeof p[field] !== 'string' || p[field] === '') errors.push(`"${field}" must be a non-empty string`);
  if (p.proposalId !== proposalId) errors.push('"proposalId" does not match its file name');
  for (const field of ARRAYS) if (!Array.isArray(p[field])) errors.push(`"${field}" must be an array`);
  if (p.status === 'draft') {
    if (typeof p.content !== 'object' || p.content === null) errors.push('a draft must have content');
    if (p.error !== null) errors.push('a draft must not have an error');
  } else if (p.status === 'failed') {
    if (p.content !== null) errors.push('a failed attempt must not have content');
    if (typeof p.error !== 'object' || p.error === null) errors.push('a failed attempt must have an error');
  } else {
    errors.push('"status" must be "draft" or "failed"');
  }
  return errors;
}

/** One immutable JSON file per proposal: <proposalsDir>/<proposalId>.json. Never overwritten. */
export class ProposalRepository {
  constructor(private readonly dir: string = storage.proposalsDir) {}

  async create(proposal: LearningProposal): Promise<void> {
    const filePath = this.pathFor(proposal.proposalId);
    const errors = validateStored(proposal, proposal.proposalId);
    if (errors.length > 0) throw new ProposalRepositoryError(`Refusing to store invalid proposal: ${errors.join('; ')}`);
    try {
      await createJsonExclusive(filePath, proposal);
    } catch (error) {
      throw new ProposalRepositoryError(`Failed to create proposal "${filePath}"`, { cause: error });
    }
  }

  /** Returns null for unknown ids. Throws on unreadable or corrupted files (left unchanged). */
  async findById(proposalId: string): Promise<LearningProposal | null> {
    if (!PROPOSAL_ID_PATTERN.test(proposalId)) return null;
    const filePath = this.pathFor(proposalId);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ProposalRepositoryError(`Failed to read proposal "${filePath}"`, { cause: error });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new ProposalRepositoryError(`Proposal "${filePath}" contains invalid JSON. The file was left unchanged.`, { cause: error });
    }
    const errors = validateStored(parsed, proposalId);
    if (errors.length > 0) {
      throw new ProposalRepositoryError(`Proposal "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
    }
    return parsed as LearningProposal;
  }

  /** Every readable proposal generated from an analysis. Invalid files are skipped and logged, never modified. */
  async findByAnalysisId(analysisId: string): Promise<LearningProposal[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ProposalRepositoryError(`Failed to list proposals in "${this.dir}"`, { cause: error });
    }
    const proposals: LearningProposal[] = [];
    for (const name of names) {
      const proposalId = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!PROPOSAL_ID_PATTERN.test(proposalId)) continue;
      try {
        const proposal = await this.findById(proposalId);
        if (proposal?.analysisId === analysisId) proposals.push(proposal);
      } catch (error) {
        console.error(`[proposals] Skipping unreadable proposal ${proposalId} while listing analysis ${analysisId}`, error);
      }
    }
    return proposals;
  }

  private pathFor(proposalId: string): string {
    if (!PROPOSAL_ID_PATTERN.test(proposalId)) throw new ProposalRepositoryError(`Invalid proposal id: ${JSON.stringify(proposalId)}`);
    return path.join(this.dir, `${proposalId}.json`);
  }
}

export const proposalRepository = new ProposalRepository();
