import path from 'node:path';

import { REELS_DIR, buildReelPaths } from '../storage/paths.js';
import { listDirectories, readJson, readTextFile } from '../utils/fs.js';

/**
 * List available harvested reel ids.
 * @returns {Promise<string[]>}
 */
export async function listHarvestedReelIds() {
  const dirs = await listDirectories(REELS_DIR);
  return dirs.map((dir) => path.basename(dir)).sort();
}

/**
 * Load the common local assets for one harvested reel.
 * @param {string} reelId
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadReferenceBundle(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);

  const [meta, source, manifest, transcriptText] = await Promise.all([
    readJson(reelPaths.metaPath, {}),
    readJson(reelPaths.sourcePath, {}),
    readJson(reelPaths.manifestPath, {}),
    readTextFile(reelPaths.transcriptTextPath).catch(() => '')
  ]);

  return {
    reelId,
    reelPaths,
    meta,
    source,
    manifest,
    transcriptText
  };
}
