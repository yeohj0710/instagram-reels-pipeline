import { env } from '../config/env.js';
import { processReelUrl } from '../main.js';
import { closeBrowserContext, launchBrowserContext, saveStorageState } from '../scraper/browser.js';
import { buildReelPaths } from '../storage/paths.js';
import { readJson } from '../utils/fs.js';
import { getReference, listReferences, touchReferenceProcessed } from './references.js';

async function loadMetaForReel(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);
  return readJson(reelPaths.metaPath, {});
}

/**
 * Process curated references inside a single authenticated browser session.
 * @param {string[]} reelIds
 * @returns {Promise<Array<{ reelId: string, manifest: Record<string, unknown> }>>}
 */
export async function processReferenceIds(reelIds) {
  const targets = Array.from(new Set((Array.isArray(reelIds) ? reelIds : []).filter(Boolean)));

  if (targets.length === 0) {
    return [];
  }

  const session = await launchBrowserContext({
    headless: env.PLAYWRIGHT_HEADLESS,
    requireAuth: true
  });

  try {
    const results = [];

    for (let index = 0; index < targets.length; index += 1) {
      const reelId = targets[index];
      const reference = await getReference(reelId);

      if (!reference?.url) {
        throw new Error(`Reference ${reelId} does not have a saved URL.`);
      }

      const manifest = await processReelUrl(session.context, reference.url, index + 1, targets.length);
      const meta = await loadMetaForReel(reelId);
      await touchReferenceProcessed(reelId, meta);

      results.push({ reelId, manifest });
    }

    await saveStorageState(session.context);
    return results;
  } finally {
    await closeBrowserContext(session);
  }
}

/**
 * Process one curated reference by id.
 * @param {string} reelId
 * @returns {Promise<{ reelId: string, manifest: Record<string, unknown> } | null>}
 */
export async function processReferenceById(reelId) {
  const results = await processReferenceIds([reelId]);
  return results[0] ?? null;
}

/**
 * Process references that do not have a completed processing state yet.
 * @param {{ collectionType?: string }} [options]
 * @returns {Promise<Array<{ reelId: string, manifest: Record<string, unknown> }>>}
 */
export async function processPendingReferences(options = {}) {
  const references = await listReferences({
    collectionType: options.collectionType
  });

  const pendingIds = references
    .filter((reference) => reference.status.processing !== 'ready')
    .map((reference) => reference.reelId);

  return processReferenceIds(pendingIds);
}
