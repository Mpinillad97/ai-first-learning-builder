import { Router } from 'express';
import { getSource } from '../controllers/source.controller.js';

export const sourceRouter = Router();

sourceRouter.get('/sources/:sourceId', getSource);
