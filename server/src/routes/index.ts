import { Router } from 'express';
import { analysisRouter } from './analysis.routes.js';
import { documentRouter } from './document.routes.js';
import { healthRouter } from './health.routes.js';
import { projectRouter } from './project.routes.js';
import { proposalRouter } from './proposal.routes.js';
import { reviewRouter } from './review.routes.js';
import { sourceRouter } from './source.routes.js';

const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(documentRouter);
apiRouter.use(sourceRouter);
apiRouter.use(analysisRouter);
apiRouter.use(proposalRouter);
apiRouter.use(projectRouter);
apiRouter.use(reviewRouter);

export const routes = Router();

routes.use('/api', apiRouter);
