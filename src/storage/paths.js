import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDir, sanitizeFileSegment } from '../utils/fs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const INPUT_DIR = path.join(DATA_DIR, 'input');
export const INPUT_REELS_PATH = path.join(INPUT_DIR, 'reels.txt');
export const AUTH_DIR = path.join(DATA_DIR, 'auth');
export const AUTH_STATE_PATH = path.join(AUTH_DIR, 'storageState.json');
export const REELS_DIR = path.join(DATA_DIR, 'reels');

/**
 * Ensure the base project data directories exist.
 * @returns {Promise<void>}
 */
export async function ensureProjectDirectories() {
  await Promise.all([
    ensureDir(DATA_DIR),
    ensureDir(INPUT_DIR),
    ensureDir(AUTH_DIR),
    ensureDir(REELS_DIR)
  ]);
}

/**
 * Parse an Instagram shortcode from a reel-like URL.
 * @param {string} urlString
 * @returns {string | null}
 */
export function parseShortcodeFromUrl(urlString) {
  try {
    const url = new URL(urlString);
    const parts = url.pathname.split('/').filter(Boolean);
    const markerIndex = parts.findIndex((part) => ['reel', 'reels', 'p', 'tv'].includes(part));

    if (markerIndex >= 0 && parts[markerIndex + 1]) {
      return sanitizeFileSegment(parts[markerIndex + 1], 'reel');
    }

    if (parts.length > 0) {
      return sanitizeFileSegment(parts.at(-1), 'reel');
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Build deterministic output paths for one Reel.
 * @param {string} urlString
 * @returns {{
 *   reelId: string,
 *   reelDir: string,
 *   sourcePath: string,
 *   metaPath: string,
 *   mediaDir: string,
 *   videoPath: string,
 *   audioSourcePath: string,
 *   mergedVideoPath: string,
 *   audioPath: string,
 *   framesDir: string,
 *   transcriptDir: string,
 *   transcriptJsonPath: string,
 *   transcriptTextPath: string,
 *   manifestPath: string
 * }}
 */
export function buildReelPaths(urlString) {
  const reelId = parseShortcodeFromUrl(urlString) ?? sanitizeFileSegment(urlString, 'reel');
  const reelDir = path.join(REELS_DIR, reelId);
  const mediaDir = path.join(reelDir, 'media');
  const transcriptDir = path.join(reelDir, 'transcript');

  return {
    reelId,
    reelDir,
    sourcePath: path.join(reelDir, 'source.json'),
    metaPath: path.join(reelDir, 'meta.json'),
    mediaDir,
    videoPath: path.join(mediaDir, 'video.mp4'),
    audioSourcePath: path.join(mediaDir, '_audio-source.mp4'),
    mergedVideoPath: path.join(mediaDir, '_video-merged.mp4'),
    audioPath: path.join(mediaDir, 'audio.mp3'),
    framesDir: path.join(mediaDir, 'frames'),
    transcriptDir,
    transcriptJsonPath: path.join(transcriptDir, 'transcript.json'),
    transcriptTextPath: path.join(transcriptDir, 'transcript.txt'),
    manifestPath: path.join(reelDir, 'manifest.json')
  };
}

/**
 * Ensure all directories for a Reel output bundle exist.
 * @param {ReturnType<typeof buildReelPaths>} reelPaths
 * @returns {Promise<void>}
 */
export async function ensureReelDirectories(reelPaths) {
  await Promise.all([
    ensureDir(reelPaths.reelDir),
    ensureDir(reelPaths.mediaDir),
    ensureDir(reelPaths.framesDir),
    ensureDir(reelPaths.transcriptDir)
  ]);
}
