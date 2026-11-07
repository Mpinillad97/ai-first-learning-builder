import { Router } from 'express';
import {
  getCompetencyProfiles, getProposalTrainingList, getTrainingById, getTrainingDocument, getTrainingReviews, postProposalTrainings, postTrainingReview,
} from '../controllers/training.controller.js';

export const trainingRouter = Router();

trainingRouter.get('/competency-profiles', getCompetencyProfiles);
trainingRouter.get('/proposals/:proposalId/trainings', getProposalTrainingList);
trainingRouter.post('/proposals/:proposalId/trainings', postProposalTrainings);
trainingRouter.get('/trainings/:trainingId', getTrainingById);
trainingRouter.get('/trainings/:trainingId/document', getTrainingDocument);
trainingRouter.get('/trainings/:trainingId/reviews', getTrainingReviews);
trainingRouter.post('/trainings/:trainingId/reviews', postTrainingReview);
