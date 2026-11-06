import { Router } from 'express';
import { getAnalysisById, postDocumentAnalysis } from '../controllers/analysis.controller.js';

export const analysisRouter = Router();

analysisRouter.post('/documents/:id/analyses', postDocumentAnalysis);
analysisRouter.get('/analyses/:analysisId', getAnalysisById);
