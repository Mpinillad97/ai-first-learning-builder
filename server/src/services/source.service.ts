import { HttpError } from '../middleware/error.middleware.js';
import { documentRepository } from '../repositories/document.repository.js';
import { extractionRepository } from '../repositories/extraction.repository.js';
import type { SourceFragment, SourceLocator } from '../types/source.types.js';

/**
 * <documentId>:<extractionId>:page:<pageNumber>          pageNumber >= 1
 * <documentId>:<extractionId>:paragraph:<paragraphIndex> paragraphIndex >= 0
 * Document ids cannot contain ":" and extraction ids are ext_<32 hex>, so the format is unambiguous.
 */
const SOURCE_ID = /^([A-Za-z0-9_-]{1,128}):(ext_[0-9a-f]{32}):(page|paragraph):(0|[1-9]\d{0,8})$/;

export interface ParsedSourceId {
  documentId: string;
  extractionId: string;
  locator: SourceLocator;
}

/** Pure parsing; never touches storage. Returns null for any malformed id. */
export function parseSourceId(sourceId: string): ParsedSourceId | null {
  const match = SOURCE_ID.exec(sourceId);
  if (!match) return null;
  const [, documentId, extractionId, kind, rawPosition] = match as unknown as [string, string, string, string, string];
  const position = Number(rawPosition);
  if (kind === 'page') {
    return position >= 1 ? { documentId, extractionId, locator: { type: 'pdf-page', pageNumber: position } } : null;
  }
  return { documentId, extractionId, locator: { type: 'docx-paragraph', paragraphIndex: position } };
}

export function buildSourceId(documentId: string, extractionId: string, locator: SourceLocator): string {
  return locator.type === 'pdf-page'
    ? `${documentId}:${extractionId}:page:${locator.pageNumber}`
    : `${documentId}:${extractionId}:paragraph:${locator.paragraphIndex}`;
}

/** Resolves a source id against the exact (current or historical) extraction it names. */
export async function resolveSource(sourceId: string): Promise<SourceFragment> {
  const parsed = parseSourceId(sourceId);
  if (!parsed) {
    throw new HttpError(
      400,
      'Malformed source id. Expected "<documentId>:<extractionId>:page:<n>" (n >= 1) or "<documentId>:<extractionId>:paragraph:<i>" (i >= 0).',
    );
  }
  const { documentId, extractionId, locator } = parsed;

  if (!(await documentRepository.findById(documentId))) throw new HttpError(404, 'Document not found.');

  const found = await extractionRepository.findInHistory(documentId, extractionId);
  if (!found) throw new HttpError(404, 'Extraction not found for this document.');
  const { extraction, isCurrent } = found;

  let text: string | undefined;
  if (locator.type === 'pdf-page') {
    if (extraction.format !== 'pdf') throw new HttpError(400, 'A page locator cannot be used with a DOCX extraction.');
    text = extraction.pages[locator.pageNumber - 1]?.text;
  } else {
    if (extraction.format !== 'docx') throw new HttpError(400, 'A paragraph locator cannot be used with a PDF extraction.');
    text = extraction.paragraphs.find((p) => p.paragraphIndex === locator.paragraphIndex)?.text;
  }
  if (!text) throw new HttpError(404, 'No text exists at this location in the extraction.');

  return { sourceId: buildSourceId(documentId, extractionId, locator), documentId, extractionId, locator, text, isCurrent };
}
