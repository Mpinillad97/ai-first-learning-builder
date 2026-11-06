import { Router } from 'express';
import {
  getDocumentById,
  getDocumentExtraction,
  getDocuments,
  postDocument,
  postProcessDocument,
} from '../controllers/document.controller.js';
import { singleFileUpload } from '../middleware/upload.middleware.js';

export const documentRouter = Router();

documentRouter.post('/documents', singleFileUpload, postDocument);
documentRouter.get('/documents', getDocuments);
documentRouter.get('/documents/:id', getDocumentById);
documentRouter.post('/documents/:id/process', postProcessDocument);
documentRouter.get('/documents/:id/extraction', getDocumentExtraction);
