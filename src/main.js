import { env } from './config/env.js';
import { extractFrames } from './processor/frames.js';
import { downloadMediaFromBrowserContext, extractAudio, probeMedia } from './processor/media.js';
import { transcribeAudioFile } from './processor/transcript.js';
import { closeBrowserContext, launchBrowserContext, saveStorageState } from './scraper/browser.js';
import {
  collectReelSource,
  listDownloadableVideoCandidates,
  loadInputReelUrls,
  normalizeSourceToMeta
} from './scraper/instagram.js';
import { finalizeManifest, loadOrCreateManifest, markStatus, recordError, saveManifest } from './storage/manifest.js';
import { buildReelPaths, ensureProjectDirectories, ensureReelDirectories, INPUT_REELS_PATH } from './storage/paths.js';
import { fileExists, writeJson } from './utils/fs.js';
import { log } from './utils/log.js';

async function attemptVideoDownload(page, reelPaths, source, meta, manifest) {
  const candidates = listDownloadableVideoCandidates(source);

  if (candidates.length === 0) {
    recordError(
      manifest,
      'downloaded_video',
      'No direct downloadable media URL was available from the logged-in browser context.'
    );
    return meta;
  }

  for (const candidate of candidates) {
    try {
      const downloadInfo = await downloadMediaFromBrowserContext(page, candidate, reelPaths.videoPath);
      markStatus(manifest, 'downloaded_video');

      meta.download = {
        source: candidate,
        bytes: downloadInfo.bytes,
        contentType: downloadInfo.contentType
      };

      try {
        meta.videoProbe = await probeMedia(reelPaths.videoPath);
      } catch (error) {
        recordError(manifest, 'ffprobe', error);
      }

      await writeJson(reelPaths.metaPath, meta);
      return meta;
    } catch (error) {
      recordError(manifest, 'downloaded_video', `Candidate ${candidate.url} failed: ${String(error.message ?? error)}`);
    }
  }

  return meta;
}

/**
 * Process one Reel URL end to end.
 * @param {import('playwright').BrowserContext} context
 * @param {string} url
 * @param {number} index
 * @param {number} total
 * @returns {Promise<Record<string, unknown>>}
 */
export async function processReelUrl(context, url, index, total) {
  const reelPaths = buildReelPaths(url);
  await ensureReelDirectories(reelPaths);

  const manifest = await loadOrCreateManifest(reelPaths, {
    reelId: reelPaths.reelId,
    sourceUrl: url
  });

  const page = await context.newPage();

  try {
    log.info(`Processing Reel ${index}/${total}`, { reelId: reelPaths.reelId, url });

    const source = await collectReelSource(page, url);
    await writeJson(reelPaths.sourcePath, source);

    let meta = normalizeSourceToMeta(source);
    await writeJson(reelPaths.metaPath, meta);
    markStatus(manifest, 'fetched_meta');
    await saveManifest(reelPaths, manifest);

    meta = await attemptVideoDownload(page, reelPaths, source, meta, manifest);
    await saveManifest(reelPaths, manifest);

    if (await fileExists(reelPaths.videoPath)) {
      try {
        await extractAudio(reelPaths.videoPath, reelPaths.audioPath);
        markStatus(manifest, 'extracted_audio');
      } catch (error) {
        recordError(manifest, 'extracted_audio', error);
      }
    }

    await saveManifest(reelPaths, manifest);

    if (await fileExists(reelPaths.audioPath)) {
      try {
        await transcribeAudioFile(reelPaths.audioPath, reelPaths.transcriptJsonPath, reelPaths.transcriptTextPath, {
          language: env.TRANSCRIPT_LANGUAGE
        });
        markStatus(manifest, 'transcribed_audio');
      } catch (error) {
        recordError(manifest, 'transcribed_audio', error);
      }
    }

    await saveManifest(reelPaths, manifest);

    if (await fileExists(reelPaths.videoPath)) {
      try {
        await extractFrames(reelPaths.videoPath, reelPaths.framesDir, env.FRAME_INTERVAL_SECONDS);
        markStatus(manifest, 'extracted_frames');
      } catch (error) {
        recordError(manifest, 'extracted_frames', error);
      }
    }

    await saveManifest(reelPaths, manifest);
    return manifest;
  } catch (error) {
    recordError(manifest, 'pipeline', error);
    await saveManifest(reelPaths, manifest);
    return manifest;
  } finally {
    finalizeManifest(manifest);
    await saveManifest(reelPaths, manifest);
    await page.close().catch(() => {});
  }
}

/**
 * Run the full pipeline for every URL in data/input/reels.txt.
 * @returns {Promise<{ total: number, errorCount: number }>}
 */
export async function runPipeline() {
  // Compliance note: this pipeline intentionally processes only user-supplied URLs.
  await ensureProjectDirectories();

  const urls = await loadInputReelUrls(INPUT_REELS_PATH);

  if (urls.length === 0) {
    log.warn(`No Reel URLs found in ${INPUT_REELS_PATH}.`);
    return { total: 0, errorCount: 0 };
  }

  const session = await launchBrowserContext({
    headless: env.PLAYWRIGHT_HEADLESS,
    requireAuth: true
  });

  try {
    let errorCount = 0;

    for (let index = 0; index < urls.length; index += 1) {
      const manifest = await processReelUrl(session.context, urls[index], index + 1, urls.length);

      if (Array.isArray(manifest.errors) && manifest.errors.length > 0) {
        errorCount += 1;
      }
    }

    await saveStorageState(session.context);
    log.info('Pipeline complete.', { total: urls.length, errorCount });
    return { total: urls.length, errorCount };
  } finally {
    await closeBrowserContext(session);
  }
}
