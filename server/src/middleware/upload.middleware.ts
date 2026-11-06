import type { RequestHandler } from 'express';
import multer from 'multer';
import { HttpError } from './error.middleware.js';
import { MAX_UPLOAD_BYTES } from '../services/document.service.js';

export const UPLOAD_FIELD = 'file';

// Memory storage: the file is validated before anything touches disk, and the service decides
// the physical filename. 15 MB per request is acceptable for a local single-user tool.
const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8', // decode non-ASCII filenames correctly (busboy defaults to latin1)
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 10,
    fieldSize: 1024,
  },
}).single(UPLOAD_FIELD);

const MULTER_ERRORS: Partial<Record<multer.ErrorCode, HttpError>> = {
  LIMIT_FILE_SIZE: new HttpError(413, `File exceeds the maximum size of ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`),
  LIMIT_FILE_COUNT: new HttpError(400, 'Upload exactly one file per request.'),
  LIMIT_UNEXPECTED_FILE: new HttpError(400, `Upload exactly one file, in the "${UPLOAD_FIELD}" form field.`),
};

/** Parses a single-file multipart upload and translates parser errors into client errors. */
export const singleFileUpload: RequestHandler = (req, res, next) => {
  upload(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return next(MULTER_ERRORS[error.code] ?? new HttpError(400, `Invalid upload: ${error.message}.`));
    }
    // Remaining parser errors come from malformed multipart bodies.
    console.error('[upload] Multipart parsing failed', error);
    return next(new HttpError(400, 'Malformed multipart/form-data request.'));
  });
};
