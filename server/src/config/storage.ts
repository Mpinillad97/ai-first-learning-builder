import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolved from this module's own location, not process.cwd(). This file sits two levels below
// the server root both as source (src/config/storage.ts) and compiled (dist/config/storage.js).
const serverRoot = fileURLToPath(new URL('../../', import.meta.url));

export interface StorageConfig {
  /** Application JSON data. */
  dataDir: string;
  /** Original uploaded documents, stored unmodified. */
  originalsDir: string;
}

export const storage: StorageConfig = {
  dataDir: path.join(serverRoot, 'data'),
  originalsDir: path.join(serverRoot, 'storage', 'originals'),
};
