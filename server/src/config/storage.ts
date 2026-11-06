import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this module's own location, not process.cwd(). This file sits two levels below
// the server root both as source (src/config/storage.ts) and compiled (dist/config/storage.js).
const serverRoot = fileURLToPath(new URL('../../', import.meta.url));

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
  /** One JSON file per document with its extracted text: <documentId>.json. */
  extractionsDir: string;
}

export const storage: StorageConfig = {
  dataDir,
  storageDir,
  originalsDir: path.join(storageDir, 'originals'),
  documentsFile: path.join(dataDir, 'documents.json'),
  extractionsDir: path.join(dataDir, 'extractions'),
};
