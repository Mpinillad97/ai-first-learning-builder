import type { Request, Response } from 'express';
import { resolveSource } from '../services/source.service.js';

export async function getSource(req: Request<{ sourceId: string }>, res: Response): Promise<void> {
  res.status(200).json(await resolveSource(req.params.sourceId));
}
