import { Router } from 'express';
import { getAnalysisFindings, postFindingDecision } from '../controllers/finding.controller.js';

export const findingRouter = Router();

findingRouter.get('/analyses/:analysisId/findings', getAnalysisFindings);
findingRouter.post('/analyses/:analysisId/findings/:findingId/decisions', postFindingDecision);
