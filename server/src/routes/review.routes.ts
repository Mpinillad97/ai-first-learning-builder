import { Router } from 'express';
import { getProposalReviews, postProposalReview } from '../controllers/review.controller.js';

export const reviewRouter = Router();

reviewRouter.get('/proposals/:proposalId/reviews', getProposalReviews);
reviewRouter.post('/proposals/:proposalId/reviews', postProposalReview);
