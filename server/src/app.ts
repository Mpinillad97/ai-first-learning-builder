import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { routes } from './routes/index.js';

export const app = express();

app.use(express.json());

app.use(routes);

app.use(notFoundHandler);
app.use(errorHandler);
