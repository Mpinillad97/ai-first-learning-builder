import type { Request, Response } from 'express';
import { createImpactAnalysis, getImpactAnalysis, listCompatibleProposals, listImpactAnalyses } from '../services/impact.service.js';

type Params = { id: string; documentId: string };

export async function getCompatibleProposals(req: Request<Params & { version: string }>, res: Response): Promise<void> {
  res.status(200).json(await listCompatibleProposals(req.params.id, req.params.documentId, req.params.version));
}

export async function postImpactAnalysis(req: Request<Params>, res: Response): Promise<void> {
  const analysis = await createImpactAnalysis(req.params.id, req.params.documentId, req.body);
  res.status(201).location(`/api/impact-analyses/${analysis.impactAnalysisId}`).json(analysis);
}

export async function getImpactAnalyses(req: Request<Params>, res: Response): Promise<void> {
  res.status(200).json(await listImpactAnalyses(req.params.id, req.params.documentId, req.query as Record<string, unknown>));
}

export async function getImpactAnalysisById(req: Request<{ impactAnalysisId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getImpactAnalysis(req.params.impactAnalysisId));
}
