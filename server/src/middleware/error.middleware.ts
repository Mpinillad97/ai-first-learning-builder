import type { ErrorRequestHandler, RequestHandler } from 'express';

interface ErrorResponseBody {
  error: {
    status: number;
    message: string;
  };
}

/** Error with an HTTP status. 4xx messages are sent to the client, so keep them safe and user-facing. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function errorBody(status: number, message: string): ErrorResponseBody {
  return { error: { status, message } };
}

/** Reads an HTTP status from errors thrown by Express or its middleware (e.g. invalid JSON). */
function getStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null) {
    const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
    const candidate = typeof status === 'number' ? status : statusCode;
    if (typeof candidate === 'number' && candidate >= 400 && candidate < 600) {
      return candidate;
    }
  }
  return 500;
}

/** Handles requests that matched no route. Register after all routes. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json(errorBody(404, `Route not found: ${req.method} ${req.path}`));
};

/** Centralized error handler. Register last. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const status = getStatus(err);
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}`, err);

  // Only client errors (4xx) get a descriptive message; server errors stay generic.
  const message =
    status < 500 && err instanceof Error && err.message ? err.message : 'Internal Server Error';

  res.status(status).json(errorBody(status, message));
};
