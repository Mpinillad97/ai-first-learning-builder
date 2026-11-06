import { createHash } from 'node:crypto';
import type { ExtractionFormat } from '../types/extraction.types.js';

/**
 * Extraction identity, scheme v1. FROZEN: changing anything here changes every extraction ID.
 * A different algorithm must use a new scheme tag and keep verifying v1 IDs with this one.
 */
export const EXTRACTION_ID_SCHEME = 'lb-extraction-id/v1';

/** Bump an entry whenever that extractor's output rules change (including library upgrades that change output). */
export const EXTRACTOR_VERSIONS = {
  pdf: 'pdf@1',
  docx: 'docx@2', // docx@2: paragraphIndex is the original position (gaps for empty paragraphs)
} as const satisfies Record<ExtractionFormat, string>;

export const EXTRACTION_ID_PATTERN = /^ext_[0-9a-f]{32}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;
export const EXTRACTOR_VERSION_PATTERN = /^(pdf|docx)@[1-9]\d*$/;

/** [position, text]: PDF [pageNumber, text] for every page (including ""); DOCX [paragraphIndex, text]. */
export type IdentityUnit = [number, string];

type UnitSource =
  | { format: 'pdf'; pages: { pageNumber: number; text: string }[] }
  | { format: 'docx'; paragraphs: { paragraphIndex: number; text: string }[] };

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function identityUnits(source: UnitSource): IdentityUnit[] {
  return source.format === 'pdf'
    ? source.pages.map((page): IdentityUnit => [page.pageNumber, page.text])
    : source.paragraphs.map((paragraph): IdentityUnit => [paragraph.paragraphIndex, paragraph.text]);
}

/** fullText rule: non-empty unit texts in order, separated by a blank line. */
export function buildFullText(units: IdentityUnit[]): string {
  return units
    .map(([, text]) => text)
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/**
 * ext_ + first 32 hex chars of SHA-256 over the UTF-8 encoding of
 * JSON.stringify([scheme, format, extractorVersion, sourceSha256, units]).
 * Only arrays, strings and integers are serialized, so the encoding is unambiguous:
 * positions are fixed, every string is quoted and escaped, and lone surrogates are escaped (ES2019+).
 */
export function computeExtractionId(
  format: ExtractionFormat,
  extractorVersion: string,
  sourceSha256: string,
  units: IdentityUnit[],
): string {
  const canonical = JSON.stringify([EXTRACTION_ID_SCHEME, format, extractorVersion, sourceSha256, units]);
  return `ext_${sha256Hex(Buffer.from(canonical, 'utf8')).slice(0, 32)}`;
}
