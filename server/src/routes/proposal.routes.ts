import { Router } from 'express';
import { getAnalysisProposals, getProposalById, postAnalysisProposal } from '../controllers/proposal.controller.js';

export const proposalRouter = Router();

proposalRouter.post('/analyses/:analysisId/proposals', postAnalysisProposal);
proposalRouter.get('/analyses/:analysisId/proposals', getAnalysisProposals);
proposalRouter.get('/proposals/:proposalId', getProposalById);
