import type { Request, Response } from 'express';
import { analyzeDocument, getAnalysis, listDocumentAnalyses } from '../services/analysis.service.js';

export async function postDocumentAnalysis(req: Request<{ id: string }>, res: Response): Promise<void> {
  const analysis = await analyzeDocument(req.params.id);
  res.status(201).location(`/api/analyses/${analysis.analysisId}`).json(analysis);
}

export async function getDocumentAnalyses(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await listDocumentAnalyses(req.params.id));
}

export async function getAnalysisById(req: Request<{ analysisId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getAnalysis(req.params.analysisId));
}
