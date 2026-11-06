import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfPage } from '../types/extraction.types.js';
import { ExtractionError, tidyText } from './extraction-error.js';

/**
 * Extracts the text layer of each page, in page order. Pages without a text layer (e.g. scanned
 * images) yield an empty string; no OCR is attempted. Fails when no page has any text.
 */
export async function extractPdf(buffer: Buffer): Promise<PdfPage[]> {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer), // copy: pdf.js takes ownership of the array it is given
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  try {
    let pdf;
    try {
      pdf = await loadingTask.promise;
    } catch (error) {
      const reason = error instanceof Error && error.name === 'PasswordException' ? 'is password-protected' : 'could not be parsed';
      throw new ExtractionError('UNREADABLE', `The PDF ${reason}.`, { cause: error });
    }

    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        let text = '';
        for (const item of content.items) {
          if ('str' in item) {
            text += item.str;
            if (item.hasEOL) text += '\n';
          }
        }
        pages.push({ pageNumber, text: tidyText(text) });
        page.cleanup();
      } catch (error) {
        throw new ExtractionError('UNREADABLE', `Page ${pageNumber} of the PDF could not be read.`, { cause: error });
      }
    }

    if (!pages.some((page) => page.text.length > 0)) {
      throw new ExtractionError(
        'NO_TEXT',
        'The PDF has no extractable text. It may be scanned or image-only; OCR is not supported.',
      );
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}
