import type { Request, Response } from 'express';
import { generateProposal, getProposal, listAnalysisProposals } from '../services/proposal.service.js';

export async function postAnalysisProposal(req: Request<{ analysisId: string }>, res: Response): Promise<void> {
  const proposal = await generateProposal(req.params.analysisId);
  res.status(201).location(`/api/proposals/${proposal.proposalId}`).json(proposal);
}

export async function getAnalysisProposals(req: Request<{ analysisId: string }>, res: Response): Promise<void> {
  res.status(200).json(await listAnalysisProposals(req.params.analysisId));
}

export async function getProposalById(req: Request<{ proposalId: string }>, res: Response): Promise<void> {
  res.status(200).json(await getProposal(req.params.proposalId));
}
