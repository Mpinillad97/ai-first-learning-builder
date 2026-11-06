import path from 'node:path';
import { serverRoot } from './paths.js';

const dataDir = path.join(serverRoot, 'data');
const storageDir = path.join(serverRoot, 'storage');

export interface StorageConfig {
  /** Application JSON data. */
  dataDir: string;
  /** Root for stored files. Persisted file paths are relative to this directory. */
  storageDir: string;
  /** Original uploaded documents, stored unmodified. */
  originalsDir: string;
  /** JSON collection of document metadata. */
  documentsFile: string;
  /** Extraction history per document (see extraction.repository.ts). */
  extractionsDir: string;
  /** One immutable JSON file per claim analysis: <analysisId>.json. */
  analysesDir: string;
  /** One immutable JSON file per learning proposal: <proposalId>.json. */
  proposalsDir: string;
}

export const storage: StorageConfig = {
  dataDir,
  storageDir,
  originalsDir: path.join(storageDir, 'originals'),
  documentsFile: path.join(dataDir, 'documents.json'),
  extractionsDir: path.join(dataDir, 'extractions'),
  analysesDir: path.join(dataDir, 'analyses'),
  proposalsDir: path.join(dataDir, 'proposals'),
};
