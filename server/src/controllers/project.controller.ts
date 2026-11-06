import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../middleware/error.middleware.js';
import { UPLOAD_FIELD } from '../middleware/upload.middleware.js';
import { createProject, getProject, listProjectDocuments, listProjects, uploadProjectDocument } from '../services/project.service.js';

export async function postProject(req: Request, res: Response): Promise<void> {
  const project = await createProject(req.body);
  res.status(201).location(`/api/projects/${project.id}`).json(project);
}

export async function getProjects(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listProjects());
}

export async function getProjectById(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await getProject(req.params.id));
}

export async function getProjectDocuments(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await listProjectDocuments(req.params.id));
}

/** Runs before the upload is parsed, so files are never read or stored for unknown projects. */
export async function requireProject(req: Request<{ id: string }>, _res: Response, next: NextFunction): Promise<void> {
  await getProject(req.params.id);
  next();
}

export async function postProjectDocument(req: Request<{ id: string }>, res: Response): Promise<void> {
  if (!req.file) {
    throw new HttpError(400, `No file uploaded. Send multipart/form-data with the file in the "${UPLOAD_FIELD}" field.`);
  }
  const document = await uploadProjectDocument(req.params.id, {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    buffer: req.file.buffer,
  });
  res.status(201).location(`/api/documents/${document.id}`).json(document);
}
