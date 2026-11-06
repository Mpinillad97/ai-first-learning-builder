import { randomUUID } from 'node:crypto';
import { link, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const serialize = (data: unknown): string => `${JSON.stringify(data, null, 2)}\n`;
const tempPathFor = (filePath: string): string => `${filePath}.${process.pid}.${randomUUID()}.tmp`;

/**
 * Writes JSON to a unique temp file next to the target and renames it into place, so readers
 * never see a half-written file. Replaces an existing file. Creates the parent directory when needed.
 */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tempPath = tempPathFor(filePath);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tempPath, serialize(data), 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Creates a JSON file that must not already exist: writes a complete temp file, then hard-links it
 * to the target. link() is atomic and fails with EEXIST instead of replacing an existing file.
 */
export async function createJsonExclusive(filePath: string, data: unknown): Promise<void> {
  const tempPath = tempPathFor(filePath);
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(tempPath, serialize(data), 'utf8');
    await link(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
