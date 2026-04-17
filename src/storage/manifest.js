import { readJson, writeJson } from '../utils/fs.js';

function now() {
  return new Date().toISOString();
}

/**
 * Create a fresh manifest object.
 * @param {{ reelId: string, sourceUrl: string }} input
 * @returns {Record<string, unknown>}
 */
export function createManifest(input) {
  const timestamp = now();

  return {
    reelId: input.reelId,
    sourceUrl: input.sourceUrl,
    fetched_meta: false,
    downloaded_video: false,
    extracted_audio: false,
    transcribed_audio: false,
    extracted_frames: false,
    errors: [],
    timestamps: {
      created_at: timestamp,
      updated_at: timestamp,
      finished_at: null,
      fetched_meta: null,
      downloaded_video: null,
      extracted_audio: null,
      transcribed_audio: null,
      extracted_frames: null
    }
  };
}

function touch(manifest) {
  manifest.timestamps.updated_at = now();
}

/**
 * Load or initialize a Reel manifest.
 * @param {{ manifestPath: string }} reelPaths
 * @param {{ reelId: string, sourceUrl: string }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadOrCreateManifest(reelPaths, input) {
  const existing = await readJson(reelPaths.manifestPath, null);

  if (!existing || typeof existing !== 'object') {
    const manifest = createManifest(input);
    await writeJson(reelPaths.manifestPath, manifest);
    return manifest;
  }

  const baseline = createManifest(input);

  return {
    ...baseline,
    ...existing,
    errors: Array.isArray(existing.errors) ? existing.errors : [],
    timestamps: {
      ...baseline.timestamps,
      ...(existing.timestamps ?? {})
    }
  };
}

/**
 * Mark a manifest step as completed.
 * @param {Record<string, unknown>} manifest
 * @param {'fetched_meta'|'downloaded_video'|'extracted_audio'|'transcribed_audio'|'extracted_frames'} key
 */
export function markStatus(manifest, key) {
  manifest[key] = true;
  manifest.timestamps[key] = now();
  touch(manifest);
}

/**
 * Record a non-fatal error in the manifest.
 * @param {Record<string, unknown>} manifest
 * @param {string} step
 * @param {unknown} error
 */
export function recordError(manifest, step, error) {
  const message = error instanceof Error ? error.message : String(error);

  manifest.errors.push({
    step,
    message,
    at: now()
  });

  touch(manifest);
}

/**
 * Finalize the manifest timestamps.
 * @param {Record<string, unknown>} manifest
 */
export function finalizeManifest(manifest) {
  manifest.timestamps.finished_at = now();
  touch(manifest);
}

/**
 * Persist a manifest to disk.
 * @param {{ manifestPath: string }} reelPaths
 * @param {Record<string, unknown>} manifest
 * @returns {Promise<void>}
 */
export async function saveManifest(reelPaths, manifest) {
  touch(manifest);
  await writeJson(reelPaths.manifestPath, manifest);
}
