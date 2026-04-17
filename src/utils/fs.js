import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Ensure that a directory exists.
 * @param {string} dirPath
 * @returns {Promise<string>}
 */
export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Check whether a file or directory exists.
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
export async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a text file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function readTextFile(filePath) {
  return fs.readFile(filePath, 'utf8');
}

/**
 * Read JSON from disk with a fallback for missing files.
 * @param {string} filePath
 * @param {unknown} fallbackValue
 * @returns {Promise<unknown>}
 */
export async function readJson(filePath, fallbackValue = null) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallbackValue;
    }

    throw error;
  }
}

/**
 * Write JSON with a stable trailing newline.
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<string>}
 */
export async function writeJson(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return filePath;
}

/**
 * Write plain text with parent-directory creation.
 * @param {string} filePath
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function writeText(filePath, text) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, text, 'utf8');
  return filePath;
}

/**
 * Remove a directory tree if it exists.
 * @param {string} targetPath
 * @returns {Promise<void>}
 */
export async function removeDir(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

/**
 * Normalize CRLF/LF line endings.
 * @param {string} value
 * @returns {string}
 */
export function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n');
}

/**
 * Convert a string into a filesystem-safe segment.
 * @param {string | null | undefined} value
 * @param {string} fallback
 * @returns {string}
 */
export function sanitizeFileSegment(value, fallback = 'item') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}
