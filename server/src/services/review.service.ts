import { randomUUID } from 'node:crypto';
import { HttpError } from '../middleware/error.middleware.js';
import { PROPOSAL_ID_PATTERN, proposalRepository } from '../repositories/proposal.repository.js';
import { reviewRepository, type ReviewRepository } from '../repositories/review.repository.js';
import type { LearningProposal, Module } from '../types/proposal.types.js';
import { REVIEW_TEXT_LIMIT, type ProposalReview, type ReviewDecision, type ReviewStatus } from '../types/review.types.js';

/**
 * Human review of learning proposals. Decisions are appended to a per-proposal log; the proposal record is
 * never modified. Decisions only come from an explicit POST (there is no automatic approval anywhere).
 */

export function pendingValidationItemCount(proposal: { content: { modules: Module[] } | null }): number {
  return (proposal.content?.modules ?? []).reduce((n, m) => n + m.lessons.reduce((k, l) => k + l.content.filter((c) => c.kind === 'pending_validation').length, 0), 0);
}

export function reviewStatusOf(proposal: LearningProposal, reviews: ProposalReview[]): ReviewStatus {
  if (proposal.status !== 'draft' || proposal.validationErrors.length > 0) return 'not_reviewable';
  return reviews[0]?.decision ?? 'pending_review';
}

async function loadProposal(proposalId: string): Promise<LearningProposal> {
  if (!PROPOSAL_ID_PATTERN.test(proposalId)) throw new HttpError(400, 'Malformed proposal id.');
  const proposal = await proposalRepository.findById(proposalId);
  if (!proposal) throw new HttpError(404, 'Proposal not found.');
  return proposal;
}

export interface ReviewLog {
  proposalId: string;
  reviewStatus: ReviewStatus;
  /** Newest first. */
  reviews: ProposalReview[];
}

export async function getReviewLog(proposalId: string): Promise<ReviewLog> {
  const proposal = await loadProposal(proposalId);
  const reviews = await reviewRepository.findByProposalId(proposalId);
  return { proposalId, reviewStatus: reviewStatusOf(proposal, reviews), reviews };
}

export interface DecisionInput {
  decision: ReviewDecision;
  reason: string | null;
  comment: string | null;
  acknowledgedWarnings: boolean;
  basedOnReviewId: string | null;
}

const ALLOWED = ['decision', 'reason', 'comment', 'acknowledgedWarnings', 'basedOnReviewId'];

export function parseDecision(body: unknown): DecisionInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Invalid review: send a JSON object.');
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  for (const key of Object.keys(b)) if (!ALLOWED.includes(key)) problems.push(`"${key}" is not an allowed field`);
  if (b.decision !== 'approved' && b.decision !== 'rejected') problems.push('decision must be "approved" or "rejected"');
  const text = (field: string): string | null => {
    const v = b[field];
    if (v === undefined || v === null) return null;
    if (typeof v !== 'string') { problems.push(`${field} must be text`); return null; }
    const t = v.trim();
    if (t.length > REVIEW_TEXT_LIMIT) problems.push(`${field} must be at most ${REVIEW_TEXT_LIMIT} characters`);
    return t || null;
  };
  const reason = text('reason');
  const comment = text('comment');
  if (b.decision === 'rejected' && !reason) problems.push('a rejection requires a reason');
  if (b.decision === 'approved' && reason) problems.push('an approval does not take a rejection reason (use comment)');
  if (b.acknowledgedWarnings !== undefined && typeof b.acknowledgedWarnings !== 'boolean') problems.push('acknowledgedWarnings must be a boolean');
  if (!('basedOnReviewId' in b) || (b.basedOnReviewId !== null && typeof b.basedOnReviewId !== 'string')) {
    problems.push('basedOnReviewId is required (the id of the latest decision you saw, or null if there was none)');
  }
  if (problems.length > 0) throw new HttpError(400, `Invalid review: ${problems.join('; ')}.`);
  return {
    decision: b.decision as ReviewDecision,
    reason,
    comment,
    acknowledgedWarnings: b.acknowledgedWarnings === true,
    basedOnReviewId: b.basedOnReviewId as string | null,
  };
}

/** Serializes decisions per proposal within this process, so concurrent requests cannot both pass the checks. */
const queues = new Map<string, Promise<unknown>>();
function serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).then(operation);
  const tail = result.catch(() => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return result;
}

export interface ReviewOptions {
  /**
   * E5.3: extra checks run inside the serialized decision, before the decision is stored. Proposal versions
   * produced by a learning update (with `lineage`) can only be reviewed with this guard, through their update.
   */
  guard?: (decision: ReviewDecision) => Promise<void>;
}

/** Records an explicit human decision. Never modifies the proposal. */
export async function recordReview(proposalId: string, body: unknown, options: ReviewOptions = {}): Promise<ProposalReview> {
  const input = parseDecision(body);
  const proposal = await loadProposal(proposalId);
  if (proposal.lineage && !options.guard) {
    throw new HttpError(409, 'This proposal version was produced by a learning update; review it through that update.');
  }
  return recordDecision(input, {
    key: proposalId,
    repository: reviewRepository,
    reviewable: proposal.status === 'draft' && proposal.validationErrors.length === 0,
    subject: 'proposal',
    warningCount: proposal.warnings.length,
    pendingCount: pendingValidationItemCount(proposal),
    fields: { proposalId, analysisId: proposal.analysisId, documentId: proposal.documentId },
  }, options);
}

/** E5.5: a reviewable item (a proposal or an audience training) and where its decisions are logged. */
export interface DecisionSubject {
  key: string;
  repository: ReviewRepository;
  reviewable: boolean;
  subject: 'proposal' | 'training';
  warningCount: number;
  pendingCount: number;
  /** Identity fields stored on each review record. */
  fields: { proposalId: string; analysisId: string; documentId: string; trainingId?: string };
}

/** Shared E4.5 decision rules: acknowledgment, optimistic concurrency (basedOnReviewId), serialized append-only log. */
export async function recordDecision(input: DecisionInput, subject: DecisionSubject, options: ReviewOptions = {}): Promise<ProposalReview> {
  if (!subject.reviewable) {
    throw new HttpError(409, `This ${subject.subject} failed validation and has no reviewable content, so it cannot be approved or rejected.`);
  }
  const { warningCount, pendingCount } = subject;
  if (input.decision === 'approved' && (warningCount > 0 || pendingCount > 0) && !input.acknowledgedWarnings) {
    throw new HttpError(400, `Invalid review: approving requires acknowledging the ${subject.subject}'s ${warningCount} warning(s) and ${pendingCount} pending-validation item(s) (acknowledgedWarnings: true).`);
  }

  return serialize(`${subject.subject}:${subject.key}`, async () => {
    const reviews = await subject.repository.findByProposalId(subject.key);
    const latest = reviews[0] ?? null;
    if ((latest?.reviewId ?? null) !== input.basedOnReviewId) {
      throw new HttpError(409, `The ${subject.subject} was reviewed by someone else in the meantime. Reload its review history before deciding.`);
    }
    if (latest?.decision === input.decision) {
      throw new HttpError(409, `The ${subject.subject} is already ${input.decision}.`);
    }
    await options.guard?.(input.decision);
    const review: ProposalReview = {
      schemaVersion: 1,
      reviewId: randomUUID(),
      ...subject.fields,
      decision: input.decision,
      reason: input.decision === 'rejected' ? input.reason : null,
      comment: input.comment,
      warningsAcknowledged: input.acknowledgedWarnings,
      warningCount,
      pendingValidationItemCount: pendingCount,
      previousReviewId: latest?.reviewId ?? null,
      decidedAt: new Date().toISOString(),
    };
    await subject.repository.create(review);
    return review;
  });
}
