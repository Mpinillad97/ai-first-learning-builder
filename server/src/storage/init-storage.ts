import { mkdir } from 'node:fs/promises';
import { storage } from '../config/storage.js';

/**
 * Ensures the local storage directories exist. Missing directories are created recursively;
 * existing directories and their files are left untouched.
 */
export async function initStorage(): Promise<void> {
  for (const dir of [storage.dataDir, storage.originalsDir]) {
    try {
      await mkdir(dir, { recursive: true });
    } catch (error) {
      throw new Error(`Failed to initialize storage directory "${dir}"`, { cause: error });
    }
  }
}
