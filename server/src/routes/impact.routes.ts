import { Router } from 'express';
import { getCompatibleProposals, getImpactAnalyses, getImpactAnalysisById, postImpactAnalysis } from '../controllers/impact.controller.js';

export const impactRouter = Router();

const base = '/projects/:id/documents/:documentId';
impactRouter.get(`${base}/versions/:version/proposals`, getCompatibleProposals);
impactRouter.post(`${base}/impact-analyses`, postImpactAnalysis);
impactRouter.get(`${base}/impact-analyses`, getImpactAnalyses);
impactRouter.get('/impact-analyses/:impactAnalysisId', getImpactAnalysisById);
