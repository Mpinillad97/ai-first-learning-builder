import { Router } from 'express';
import { getAnalysisById, getDocumentAnalyses, postDocumentAnalysis } from '../controllers/analysis.controller.js';

export const analysisRouter = Router();

analysisRouter.post('/documents/:id/analyses', postDocumentAnalysis);
analysisRouter.get('/documents/:id/analyses', getDocumentAnalyses);
analysisRouter.get('/analyses/:analysisId', getAnalysisById);
