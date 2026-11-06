/**
 * Expected extraction failures caused by the document itself (not by the server).
 * `message` is safe to show to clients; technical details go in `cause` and are only logged.
 */
export type ExtractionErrorCode = 'UNREADABLE' | 'NO_TEXT' | 'UNSUPPORTED_FORMAT';

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ExtractionError';
    this.code = code;
  }
}

/** Normalizes whitespace without changing content: trims line ends and collapses runs of blank lines. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
