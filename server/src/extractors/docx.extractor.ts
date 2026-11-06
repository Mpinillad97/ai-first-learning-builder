import mammoth from 'mammoth';
import type { DocxParagraph } from '../types/extraction.types.js';
import { ExtractionError, tidyText } from './extraction-error.js';

/**
 * Extracts plain text paragraph by paragraph, in document order (body text and table cells).
 *
 * mammoth's raw text emits every paragraph, including empty ones, as its text followed by "\n\n",
 * and never emits "\n\n" inside a paragraph. Splitting on "\n\n" therefore yields exactly one entry
 * per paragraph (plus a trailing empty entry), so the split position is the paragraph's original
 * position. Empty paragraphs are omitted from the result, but `paragraphIndex` keeps the original
 * position, so indexes may have gaps (e.g. 0, 2, 4).
 */
export async function extractDocx(buffer: Buffer): Promise<DocxParagraph[]> {
  let raw: string;
  try {
    raw = (await mammoth.extractRawText({ buffer })).value;
  } catch (error) {
    throw new ExtractionError('UNREADABLE', 'The DOCX file could not be parsed.', { cause: error });
  }

  const segments = raw.split('\n\n');
  if (raw.endsWith('\n\n')) segments.pop(); // remainder after the last paragraph's terminator

  const paragraphs = segments
    .map((segment, paragraphIndex) => ({ paragraphIndex, text: tidyText(segment) }))
    .filter((paragraph) => paragraph.text.length > 0);

  if (paragraphs.length === 0) {
    throw new ExtractionError('NO_TEXT', 'The DOCX has no extractable text.');
  }
  return paragraphs;
}
