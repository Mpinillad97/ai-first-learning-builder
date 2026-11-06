import { Router } from 'express';
import { healthRouter } from './health.routes.js';

const apiRouter = Router();

apiRouter.use(healthRouter);

export const routes = Router();

routes.use('/api', apiRouter);
