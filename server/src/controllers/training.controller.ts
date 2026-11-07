import type { Request, Response } from 'express';
import { COMPETENCY_PROFILES, PROFILE_VERSION } from '../config/competency-profiles.js';
import { trainingDocument } from '../services/training-document.js';
import { generateTrainings, getProposalTrainings, getTraining, getTrainingReviewLog, recordTrainingReview } from '../services/training.service.js';

export function getCompetencyProfiles(_req: Request, res: Response): void {
  res.status(200).json({ profileVersion: PROFILE_VERSION, profiles: Object.values(COMPETENCY_PROFILES) });
}

export async function getProposalTrainingList(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getProposalTrainings(req.params.proposalId));
}

export async function postProposalTrainings(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  res.status(200).json(await generateTrainings(req.params.proposalId, req.body));
}

export async function getTrainingById(req: Request<{ trainingId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getTraining(req.params.trainingId));
}

/** Markdown deliverable; ?download=1 sends it as an attachment. */
export async function getTrainingDocument(req: Request<{ trainingId: string }>, res: Response): Promise<void> {
  const { filename, markdown } = await trainingDocument(req.params.trainingId);
  res.status(200).type('text/markdown; charset=utf-8');
  if (req.query.download === '1') res.attachment(filename);
  res.send(markdown);
}

export async function getTrainingReviews(req: Request<{ trainingId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getTrainingReviewLog(req.params.trainingId));
}

export async function postTrainingReview(req: Request<{ trainingId: string }>, res: Response): Promise<void> {
  res.status(201).json(await recordTrainingReview(req.params.trainingId, req.body));
}
