import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { storage } from '../config/storage.js';
import { REVIEW_TEXT_LIMIT, type ProposalReview } from '../types/review.types.js';
import { createJsonExclusive } from './json-file.js';

export class ReviewRepositoryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ReviewRepositoryError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const FIELDS = ['schemaVersion', 'reviewId', 'proposalId', 'analysisId', 'documentId', 'decision', 'reason', 'comment', 'warningsAcknowledged',
  'warningCount', 'pendingValidationItemCount', 'previousReviewId', 'decidedAt'];

function validateReview(value: unknown, proposalId: string, reviewId?: string): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return ['must be an object'];
  const r = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(r)) if (!FIELDS.includes(key)) errors.push(`unknown field "${key}"`);
  if (r.schemaVersion !== 1) errors.push('"schemaVersion" must be 1');
  if (typeof r.reviewId !== 'string' || !UUID.test(r.reviewId) || (reviewId !== undefined && r.reviewId !== reviewId)) errors.push('"reviewId" must match its file name');
  if (r.proposalId !== proposalId) errors.push('"proposalId" must match its directory');
  for (const f of ['analysisId', 'documentId']) if (typeof r[f] !== 'string' || !r[f]) errors.push(`"${f}" must be a non-empty string`);
  if (r.decision !== 'approved' && r.decision !== 'rejected') errors.push('"decision" must be "approved" or "rejected"');
  const text = (v: unknown) => v === null || (typeof v === 'string' && v.trim().length > 0 && v.length <= REVIEW_TEXT_LIMIT);
  if (!text(r.reason) || !text(r.comment)) errors.push('"reason" and "comment" must be null or non-empty text');
  if (r.decision === 'rejected' && r.reason === null) errors.push('a rejection must have a reason');
  if (r.decision === 'approved' && r.reason !== null) errors.push('an approval has no rejection reason');
  if (typeof r.warningsAcknowledged !== 'boolean') errors.push('"warningsAcknowledged" must be a boolean');
  for (const f of ['warningCount', 'pendingValidationItemCount']) if (!Number.isInteger(r[f]) || (r[f] as number) < 0) errors.push(`"${f}" must be a non-negative integer`);
  if (r.decision === 'approved' && (r.warningCount as number) > 0 && r.warningsAcknowledged !== true) errors.push('an approval with warnings must acknowledge them');
  if (r.previousReviewId !== null && (typeof r.previousReviewId !== 'string' || !UUID.test(r.previousReviewId))) errors.push('"previousReviewId" must be null or a UUID');
  if (typeof r.decidedAt !== 'string' || !ISO_8601.test(r.decidedAt)) errors.push('"decidedAt" must be ISO 8601');
  return errors;
}

/**
 * Append-only review log per proposal. Records are immutable; the log must form a single chain
 * (each record points to the previous one). Any invalid record or broken chain makes the whole log
 * unreadable (fail closed): an approval state is never derived from partial data.
 */
export class ReviewRepository {
  constructor(private readonly dir: string = storage.reviewsDir) {}

  async create(review: ProposalReview): Promise<void> {
    const errors = validateReview(review, review.proposalId);
    if (errors.length > 0) throw new ReviewRepositoryError(`Refusing to store invalid review: ${errors.join('; ')}`);
    const filePath = path.join(this.proposalDir(review.proposalId), `${review.reviewId}.json`);
    try {
      await createJsonExclusive(filePath, review);
    } catch (error) {
      throw new ReviewRepositoryError(`Failed to create review "${filePath}"`, { cause: error });
    }
  }

  /** The proposal's reviews, newest first. Throws if any record is invalid or the chain is broken. */
  async findByProposalId(proposalId: string): Promise<ProposalReview[]> {
    const dir = this.proposalDir(proposalId);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new ReviewRepositoryError(`Failed to list reviews in "${dir}"`, { cause: error });
    }
    const reviews: ProposalReview[] = [];
    for (const name of names) {
      const reviewId = name.endsWith('.json') ? name.slice(0, -5) : '';
      if (!UUID.test(reviewId)) continue; // temp files
      const filePath = path.join(dir, name);
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(filePath, 'utf8'));
      } catch (error) {
        throw new ReviewRepositoryError(`Review "${filePath}" is unreadable or contains invalid JSON. The file was left unchanged.`, { cause: error });
      }
      const errors = validateReview(parsed, proposalId, reviewId);
      if (errors.length > 0) throw new ReviewRepositoryError(`Review "${filePath}" is invalid: ${errors.join('; ')}. The file was left unchanged.`);
      reviews.push(parsed as ProposalReview);
    }
    return this.orderChain(reviews, dir);
  }

  /** Orders the log by following previousReviewId links; rejects forks, gaps and cycles. */
  private orderChain(reviews: ProposalReview[], dir: string): ProposalReview[] {
    if (reviews.length === 0) return [];
    const byPrevious = new Map<string | null, ProposalReview>();
    for (const r of reviews) {
      if (byPrevious.has(r.previousReviewId)) throw new ReviewRepositoryError(`Review log "${dir}" is inconsistent: two decisions replace the same one.`);
      byPrevious.set(r.previousReviewId, r);
    }
    const ordered: ProposalReview[] = [];
    let current = byPrevious.get(null);
    while (current) {
      ordered.push(current);
      current = byPrevious.get(current.reviewId);
    }
    if (ordered.length !== reviews.length) throw new ReviewRepositoryError(`Review log "${dir}" is inconsistent: the decisions do not form a single chain.`);
    return ordered.reverse();
  }

  private proposalDir(proposalId: string): string {
    if (!UUID.test(proposalId)) throw new ReviewRepositoryError(`Invalid proposal id: ${JSON.stringify(proposalId)}`);
    return path.join(this.dir, proposalId);
  }
}

export const reviewRepository = new ReviewRepository();
