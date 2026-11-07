import type { Request, Response } from 'express';
import { getReviewLog, recordReview } from '../services/review.service.js';
import { generateTrainingsInBackground } from '../services/training.service.js';

export async function getProposalReviews(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getReviewLog(req.params.proposalId));
}

export async function postProposalReview(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  const review = await recordReview(req.params.proposalId, req.body);
  // E5.5: an approved proposal produces its Sales and CE trainings (generated in the background, awaiting review).
  if (review.decision === 'approved') generateTrainingsInBackground(review.proposalId);
  res.status(201).json(review);
}
