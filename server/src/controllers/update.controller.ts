import type { Request, Response } from 'express';
import { generateTrainingsInBackground } from '../services/training.service.js';
import { generateLearningUpdate, getLearningUpdate, getProposalVersions, listLearningUpdates, reviewLearningUpdate } from '../services/update.service.js';

type Params = { id: string; documentId: string };

export async function postLearningUpdate(req: Request<Params>, res: Response): Promise<void> {
  const update = await generateLearningUpdate(req.params.id, req.params.documentId, req.body);
  res.status(201).location(`/api/learning-updates/${update.updateId}`).json(update);
}

export async function getLearningUpdates(req: Request<Params>, res: Response): Promise<void> {
  res.status(200).json(await listLearningUpdates(req.params.id, req.params.documentId, req.query as Record<string, unknown>));
}

export async function getLearningUpdateById(req: Request<{ updateId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getLearningUpdate(req.params.updateId));
}

export async function postLearningUpdateReview(req: Request<Params & { updateId: string }>, res: Response): Promise<void> {
  const review = await reviewLearningUpdate(req.params.id, req.params.documentId, req.params.updateId, req.body);
  // E5.5: an approved update candidate (new proposal version) produces its updated Sales and CE trainings.
  if (review.decision === 'approved') generateTrainingsInBackground(review.proposalId);
  res.status(201).json(review);
}

export async function getProposalVersionList(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getProposalVersions(req.params.proposalId));
}
