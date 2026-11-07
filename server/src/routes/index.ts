import { Router } from 'express';
import { analysisRouter } from './analysis.routes.js';
import { documentRouter } from './document.routes.js';
import { healthRouter } from './health.routes.js';
import { impactRouter } from './impact.routes.js';
import { projectRouter } from './project.routes.js';
import { proposalRouter } from './proposal.routes.js';
import { reviewRouter } from './review.routes.js';
import { sourceRouter } from './source.routes.js';
import { updateRouter } from './update.routes.js';
import { versionRouter } from './version.routes.js';

const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(documentRouter);
apiRouter.use(sourceRouter);
apiRouter.use(analysisRouter);
apiRouter.use(proposalRouter);
apiRouter.use(projectRouter);
apiRouter.use(reviewRouter);
apiRouter.use(versionRouter);
apiRouter.use(impactRouter);
apiRouter.use(updateRouter);

export const routes = Router();

routes.use('/api', apiRouter);
