import { Router } from 'express';
import { documentRouter } from './document.routes.js';
import { healthRouter } from './health.routes.js';
import { sourceRouter } from './source.routes.js';

const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(documentRouter);
apiRouter.use(sourceRouter);

export const routes = Router();

routes.use('/api', apiRouter);
