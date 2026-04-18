import { analyzeReference } from '../reference/run.js';
import { getReference, listReferences } from './references.js';

/**
 * Analyze one curated reference by id.
 * @param {string} reelId
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function analyzeReferenceById(reelId) {
  await analyzeReference(reelId);
  return getReference(reelId);
}

/**
 * Analyze multiple curated references.
 * @param {string[]} reelIds
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function analyzeReferenceIds(reelIds) {
  const results = [];

  for (const reelId of Array.from(new Set((Array.isArray(reelIds) ? reelIds : []).filter(Boolean)))) {
    const reference = await analyzeReferenceById(reelId);

    if (reference) {
      results.push(reference);
    }
  }

  return results;
}

/**
 * Analyze references whose focused analysis is still missing.
 * @param {{ collectionType?: string }} [options]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function analyzePendingReferences(options = {}) {
  const references = await listReferences({
    collectionType: options.collectionType
  });

  const pendingIds = references
    .filter(
      (reference) =>
        reference.status.processing !== 'pending' &&
        reference.status.focusedAnalysis !== 'ready'
    )
    .map((reference) => reference.reelId);

  return analyzeReferenceIds(pendingIds);
}
