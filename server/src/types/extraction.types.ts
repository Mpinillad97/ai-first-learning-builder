export type ExtractionFormat = 'pdf' | 'docx';

export interface PdfPage {
  /** 1-based, matching the page numbers a reader sees. */
  pageNumber: number;
  /** Text as extracted; empty string when the page has no extractable text. */
  text: string;
}

export interface DocxParagraph {
  /**
   * 0-based position of the paragraph in the original document, counting every paragraph in document
   * order (including empty ones and paragraphs inside table cells). Empty paragraphs are not returned,
   * so indexes can have gaps.
   */
  paragraphIndex: number;
  text: string;
}

/**
 * Identity metadata. All three fields are present (extractions created since E2.4) or all absent
 * (legacy extractions, readable for compatibility but never citable as sources).
 */
export interface ExtractionIdentity {
  /** ext_ + 32 hex chars, derived from format, extractor version, sourceSha256 and the stored units. */
  extractionId: string;
  /** SHA-256 (hex) of the original file the text was extracted from. */
  sourceSha256: string;
  /** e.g. "pdf@1", "docx@2". */
  extractorVersion: string;
}

interface ExtractionBase extends Partial<ExtractionIdentity> {
  documentId: string;
  /** ISO 8601. When this extraction was first created. */
  extractedAt: string;
  /** Convenience concatenation of all units, separated by blank lines. Citations should use pages/paragraphs. */
  fullText: string;
}

export interface PdfExtraction extends ExtractionBase {
  format: 'pdf';
  pages: PdfPage[];
}

export interface DocxExtraction extends ExtractionBase {
  format: 'docx';
  paragraphs: DocxParagraph[];
}

/** A stored extraction: legacy (no identity) or identified. */
export type ExtractionResult = PdfExtraction | DocxExtraction;

/** An extraction with complete identity metadata; the only kind stored in history and citable. */
export type IdentifiedExtraction = ExtractionResult & ExtractionIdentity;

/** <extractionsDir>/<documentId>/manifest.json. The only mutable file in a document's history. */
export interface ExtractionManifest {
  documentId: string;
  currentExtractionId: string;
  /** In order of first creation, without duplicates. */
  extractionIds: string[];
}
