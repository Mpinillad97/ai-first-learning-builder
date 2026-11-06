export type SourceLocator =
  | { type: 'pdf-page'; pageNumber: number } // 1-based
  | { type: 'docx-paragraph'; paragraphIndex: number }; // 0-based original position

/**
 * Read-only view of one citable unit of a stored extraction.
 *
 * `text` is the exact reference text. Future quote offsets (E3) index into it with JavaScript string
 * semantics: UTF-16 code units, `start` inclusive, `end` exclusive, i.e. `text.slice(start, end)`.
 * They never refer to fullText or to the original PDF/DOCX bytes.
 */
export interface SourceFragment {
  /** "<documentId>:<extractionId>:page:<n>" or "<documentId>:<extractionId>:paragraph:<i>". */
  sourceId: string;
  documentId: string;
  extractionId: string;
  locator: SourceLocator;
  text: string;
  /** Whether this fragment belongs to the document's current extraction. */
  isCurrent: boolean;
}
