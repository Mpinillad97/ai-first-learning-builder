import type { DocumentRecord, DocumentStatus } from './document.types.js';
import type { ExtractionFormat } from './extraction.types.js';
import type { SourceLocator } from './source.types.js';

/** One version of a logical document. Immutable once stored. */
export interface DocumentVersionEntry {
  /** 1, 2, 3, ... in upload order. */
  version: number;
  /** The physical document (DocumentRecord) holding this version's file and extraction history. */
  documentId: string;
  /** Snapshot of the uploaded filename and upload date, for the history; the document record stays authoritative. */
  originalFilename: string;
  uploadedAt: string;
}

/**
 * Persisted version history of a logical document. Only created when a second version is uploaded: a
 * document without a stored history is its own version 1. The logical document id is the id of version 1,
 * which is also the id listed in the project's documentIds.
 */
export interface DocumentVersionHistory {
  documentId: string;
  projectId: string;
  /** Ordered by version; versions[0] is the original document. */
  versions: DocumentVersionEntry[];
  createdAt: string;
  updatedAt: string;
}

/** API view of one version, with its live processing status from the document record. */
export interface DocumentVersionView extends DocumentVersionEntry {
  status: DocumentStatus;
  /** The latest uploaded version is the current one. */
  isCurrent: boolean;
  document: DocumentRecord;
}

export interface DocumentVersionsView {
  documentId: string;
  projectId: string;
  currentVersion: number;
  /** Oldest first. */
  versions: DocumentVersionView[];
}

export type ChangeType = 'added' | 'removed' | 'modified' | 'unchanged';

/** One side of a change: an extracted unit of a specific version, citable through GET /api/sources/:sourceId. */
export interface ComparedUnit {
  version: number;
  documentId: string;
  extractionId: string;
  locator: SourceLocator;
  sourceId: string;
  text: string;
}

export interface DiffSegment {
  type: 'equal' | 'removed' | 'added';
  text: string;
}

export interface DocumentChange {
  /** Deterministic: derived from both extraction ids, the change type and the source ids. */
  changeId: string;
  type: ChangeType;
  /** Unit in the older version (absent for "added"). */
  from?: ComparedUnit;
  /** Unit in the newer version (absent for "removed"). */
  to?: ComparedUnit;
  /** "modified" only: word-overlap similarity (0-1) that paired the two units. */
  similarity?: number;
  /** "modified" only: word-level differences, or absent when the units are too long to diff. */
  diff?: DiffSegment[];
}

export interface ComparedVersion {
  version: number;
  documentId: string;
  extractionId: string;
  format: ExtractionFormat;
  /** Units with text that were compared. */
  unitCount: number;
  /** PDF pages without extractable text (not comparable, not citable). */
  emptyUnitCount: number;
}

export interface DocumentComparison {
  /** Deterministic: derived from the algorithm and both extraction ids (E5.2, additive). */
  comparisonId: string;
  documentId: string;
  projectId: string;
  algorithm: string;
  comparedAt: string;
  from: ComparedVersion;
  to: ComparedVersion;
  summary: Record<ChangeType, number>;
  /** In document order; unchanged units included. */
  changes: DocumentChange[];
}
