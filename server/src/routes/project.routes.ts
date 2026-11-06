import { Router } from 'express';
import {
  getProjectById,
  getProjectDocuments,
  getProjects,
  postProject,
  postProjectDocument,
  requireProject,
} from '../controllers/project.controller.js';
import { singleFileUpload } from '../middleware/upload.middleware.js';

export const projectRouter = Router();

projectRouter.post('/projects', postProject);
projectRouter.get('/projects', getProjects);
projectRouter.get('/projects/:id', getProjectById);
projectRouter.get('/projects/:id/documents', getProjectDocuments);
projectRouter.post('/projects/:id/documents', requireProject, singleFileUpload, postProjectDocument);
