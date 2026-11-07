import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../middleware/error.middleware.js';
import { UPLOAD_FIELD } from '../middleware/upload.middleware.js';
import { compareVersions } from '../services/comparison.service.js';
import { getLogicalDocument, getVersion, listVersions, uploadVersion } from '../services/version.service.js';

type Params = { id: string; documentId: string };

export async function getVersions(req: Request<Params>, res: Response): Promise<void> {
  res.status(200).json(await listVersions(req.params.id, req.params.documentId));
}

export async function getVersionByNumber(req: Request<Params & { version: string }>, res: Response): Promise<void> {
  res.status(200).json(await getVersion(req.params.id, req.params.documentId, req.params.version));
}

/** Runs before the upload is parsed, so no file is read or stored for an unknown project or document. */
export async function requireLogicalDocument(req: Request<Params>, _res: Response, next: NextFunction): Promise<void> {
  await getLogicalDocument(req.params.id, req.params.documentId);
  next();
}

export async function postVersion(req: Request<Params>, res: Response): Promise<void> {
  if (!req.file) {
    throw new HttpError(400, `No file uploaded. Send multipart/form-data with the file in the "${UPLOAD_FIELD}" field.`);
  }
  const { id, documentId } = req.params;
  const version = await uploadVersion(id, documentId, {
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    buffer: req.file.buffer,
  });
  res.status(201).location(`/api/projects/${id}/documents/${documentId}/versions/${version.version}`).json(version);
}

export async function getComparison(req: Request<Params>, res: Response): Promise<void> {
  res.status(200).json(await compareVersions(req.params.id, req.params.documentId, req.query.from, req.query.to));
}
