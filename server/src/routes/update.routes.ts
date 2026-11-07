import { Router } from 'express';
import { getLearningUpdateById, getLearningUpdates, getProposalVersionList, postLearningUpdate, postLearningUpdateReview } from '../controllers/update.controller.js';

export const updateRouter = Router();

const base = '/projects/:id/documents/:documentId/learning-updates';
updateRouter.post(base, postLearningUpdate);
updateRouter.get(base, getLearningUpdates);
updateRouter.post(`${base}/:updateId/reviews`, postLearningUpdateReview);
updateRouter.get('/learning-updates/:updateId', getLearningUpdateById);
updateRouter.get('/proposals/:proposalId/versions', getProposalVersionList);
