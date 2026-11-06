import type { Request, Response } from 'express';
import { HttpError } from '../middleware/error.middleware.js';
import { UPLOAD_FIELD } from '../middleware/upload.middleware.js';
import { getDocument, listDocuments, uploadDocument } from '../services/document.service.js';
import { getExtraction, processDocument } from '../services/processing.service.js';

export async function postDocument(req: Request, res: Response): Promise<void> {
  if (!req.file) {
    throw new HttpError(400, `No file uploaded. Send multipart/form-data with the file in the "${UPLOAD_FIELD}" field.`);
  }

  const document = await uploadDocument({
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    buffer: req.file.buffer,
  });

  res.status(201).location(`/api/documents/${document.id}`).json(document);
}

export async function getDocuments(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listDocuments());
}

export async function getDocumentById(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await getDocument(req.params.id));
}

export async function postProcessDocument(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await processDocument(req.params.id));
}

export async function getDocumentExtraction(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json(await getExtraction(req.params.id));
}
