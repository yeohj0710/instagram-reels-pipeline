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
 * Append one JSON line to a JSONL file.
 * @param {string} filePath
 * @param {unknown} data
 * @returns {Promise<string>}
 */
export async function appendJsonl(filePath, data) {
  await ensureDir(path.dirname(filePath));
  await fs.appendFile(filePath, `${JSON.stringify(data)}\n`, 'utf8');
  return filePath;
}

/**
 * Read a JSONL file into an array.
 * @param {string} filePath
 * @returns {Promise<unknown[]>}
 */
export async function readJsonl(filePath) {
  const content = await readTextFile(filePath).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  });

  return normalizeLineEndings(content)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Write a JSONL file from an array.
 * @param {string} filePath
 * @param {unknown[]} rows
 * @returns {Promise<string>}
 */
export async function writeJsonl(filePath, rows) {
  await ensureDir(path.dirname(filePath));
  const text = rows.map((row) => JSON.stringify(row)).join('\n');
  await fs.writeFile(filePath, text ? `${text}\n` : '', 'utf8');
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
 * List direct child directories.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
export async function listDirectories(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });

  return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(dirPath, entry.name));
}

/**
 * List direct child files.
 * @param {string} dirPath
 * @returns {Promise<string[]>}
 */
export async function listFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return [];
    }

    throw error;
  });

  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(dirPath, entry.name));
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

/**
 * Create a filesystem-safe timestamp id.
 * @param {Date} [date]
 * @returns {string}
 */
export function createTimestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}
