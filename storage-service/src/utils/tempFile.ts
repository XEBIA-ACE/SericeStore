import fs from 'fs';
import os from 'os';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Write a buffer to a temporary file and return its path.
 * The caller is responsible for calling cleanupTempFile() when done.
 */
export async function bufferToTempFile(buffer: Buffer, extension: string): Promise<string> {
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `storage-svc-${uuidv4()}${extension}`);
  await fs.promises.writeFile(tmpPath, buffer);
  return tmpPath;
}

/**
 * Read a file from disk into a Buffer.
 */
export async function tempFileToBuffer(filePath: string): Promise<Buffer> {
  return fs.promises.readFile(filePath);
}

/**
 * Remove a temporary file, ignoring errors if it doesn't exist.
 */
export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // Ignore — file may already be gone
  }
}
