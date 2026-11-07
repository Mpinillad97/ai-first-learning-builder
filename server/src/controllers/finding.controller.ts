import type { Request, Response } from 'express';
import { listFindings, recordFindingDecision } from '../services/finding.service.js';

export async function getAnalysisFindings(req: Request<{ analysisId: string }>, res: Response): Promise<void> {
  res.status(200).json(await listFindings(req.params.analysisId, req.query as Record<string, unknown>));
}

export async function postFindingDecision(req: Request<{ analysisId: string; findingId: string }>, res: Response): Promise<void> {
  res.status(201).json(await recordFindingDecision(req.params.analysisId, req.params.findingId, req.body));
}
