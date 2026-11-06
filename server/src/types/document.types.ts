export const DOCUMENT_STATUSES = ['uploaded', 'processing', 'processed', 'failed'] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** Metadata for an uploaded source document. The original file itself lives in local storage. */
export interface DocumentRecord {
  id: string;
  /** Filename as provided by the uploader. Display only; never used to build paths. */
  originalFilename: string;
  /** Server-generated filename of the stored original. */
  storedFilename: string;
  mimeType: string;
  /** Lowercase, with leading dot, e.g. ".pdf". */
  extension: string;
  sizeBytes: number;
  /** Relative to the storage root (server/storage/), POSIX separators, e.g. "originals/<storedFilename>". */
  storagePath: string;
  status: DocumentStatus;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Fields that may change after creation. `id` and `createdAt` are immutable. */
export type DocumentUpdate = Partial<Omit<DocumentRecord, 'id' | 'createdAt' | 'updatedAt'>>;
