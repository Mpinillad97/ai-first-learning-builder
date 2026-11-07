import { Router } from 'express';
import { getComparison, getVersionByNumber, getVersions, postVersion, requireLogicalDocument } from '../controllers/version.controller.js';
import { singleFileUpload } from '../middleware/upload.middleware.js';

export const versionRouter = Router();

const base = '/projects/:id/documents/:documentId';
versionRouter.get(`${base}/versions`, getVersions);
versionRouter.post(`${base}/versions`, requireLogicalDocument, singleFileUpload, postVersion);
versionRouter.get(`${base}/versions/:version`, getVersionByNumber);
versionRouter.get(`${base}/comparison`, getComparison);
