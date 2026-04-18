import { promises as fs } from 'node:fs';

import { env } from './config/env.js';
import { extractFrames } from './processor/frames.js';
import {
  downloadMediaFromBrowserContext,
  extractAudio,
  inspectMp4File,
  mergeVideoAndAudio,
  probeMedia
} from './processor/media.js';
import { transcribeAudioFile } from './processor/transcript.js';
import { closeBrowserContext, launchBrowserContext, saveStorageState } from './scraper/browser.js';
import {
  collectReelSource,
  listDownloadableAudioCandidates,
  listDownloadableVideoCandidates,
  loadInputReelUrls,
  normalizeSourceToMeta
} from './scraper/instagram.js';
import { finalizeManifest, loadOrCreateManifest, markStatus, recordError, saveManifest } from './storage/manifest.js';
import { buildReelPaths, ensureProjectDirectories, ensureReelDirectories, INPUT_REELS_PATH } from './storage/paths.js';
import { fileExists, writeJson } from './utils/fs.js';
import { log } from './utils/log.js';

function probeHasAudioStream(probeData) {
  return Array.isArray(probeData?.streams) && probeData.streams.some((stream) => stream.codec_type === 'audio');
}

function probeHasVideoStream(probeData) {
  return Array.isArray(probeData?.streams) && probeData.streams.some((stream) => stream.codec_type === 'video');
}

async function cleanupTempMediaFiles(reelPaths) {
  await Promise.all([
    fs.rm(reelPaths.audioSourcePath, { force: true }).catch(() => {}),
    fs.rm(reelPaths.mergedVideoPath, { force: true }).catch(() => {})
  ]);
}

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
      const fileInspection = await inspectMp4File(reelPaths.videoPath);

      if (!fileInspection.isLikelyValid) {
        throw new Error(
          `Downloaded file does not look like a complete MP4 (size=${fileInspection.size}, atoms=${fileInspection.atoms.join(',') || 'none'}).`
        );
      }

      markStatus(manifest, 'downloaded_video');

      meta.download = {
        source: candidate,
        bytes: downloadInfo.bytes,
        contentType: downloadInfo.contentType,
        mode: downloadInfo.mode ?? 'direct',
        inspection: fileInspection
      };

      try {
        meta.videoProbe = await probeMedia(reelPaths.videoPath);
        if (!probeHasVideoStream(meta.videoProbe)) {
          throw new Error('Downloaded media candidate does not contain a video stream.');
        }
      } catch (error) {
        throw error;
      }

      await writeJson(reelPaths.metaPath, meta);
      return meta;
    } catch (error) {
      recordError(manifest, 'downloaded_video', `Candidate ${candidate.url} failed: ${String(error.message ?? error)}`);
    }
  }

  return meta;
}

async function attemptSeparateAudioRecovery(page, reelPaths, source, meta, manifest) {
  const candidates = listDownloadableAudioCandidates(source);

  if (candidates.length === 0) {
    recordError(
      manifest,
      'downloaded_audio_track',
      'Video file has no embedded audio stream and no separate audio track was detected.'
    );
    return { meta, audioInputPath: reelPaths.videoPath };
  }

  for (const candidate of candidates) {
    try {
      await cleanupTempMediaFiles(reelPaths);

      const downloadInfo = await downloadMediaFromBrowserContext(page, candidate, reelPaths.audioSourcePath);
      const audioProbe = await probeMedia(reelPaths.audioSourcePath);

      if (!probeHasAudioStream(audioProbe)) {
        throw new Error('Downloaded separate media candidate does not contain an audio stream.');
      }

      meta.audioDownload = {
        source: candidate,
        bytes: downloadInfo.bytes,
        contentType: downloadInfo.contentType,
        mode: downloadInfo.mode ?? 'direct',
        probe: audioProbe
      };

      try {
        await mergeVideoAndAudio(reelPaths.videoPath, reelPaths.audioSourcePath, reelPaths.mergedVideoPath);
        await fs.rm(reelPaths.videoPath, { force: true });
        await fs.rename(reelPaths.mergedVideoPath, reelPaths.videoPath);
        meta.videoProbe = await probeMedia(reelPaths.videoPath);
        await fs.rm(reelPaths.audioSourcePath, { force: true }).catch(() => {});
        meta.download.mergedAudioTrack = true;
        await writeJson(reelPaths.metaPath, meta);
        return { meta, audioInputPath: reelPaths.videoPath };
      } catch (mergeError) {
        recordError(manifest, 'merged_audio_track', mergeError);
        await writeJson(reelPaths.metaPath, meta);
        return { meta, audioInputPath: reelPaths.audioSourcePath };
      }
    } catch (error) {
      recordError(
        manifest,
        'downloaded_audio_track',
        `Candidate ${candidate.url} failed: ${String(error.message ?? error)}`
      );
    }
  }

  return { meta, audioInputPath: reelPaths.videoPath };
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

    let audioInputPath = reelPaths.videoPath;

    if (probeHasAudioStream(meta.videoProbe) === false && (await fileExists(reelPaths.videoPath))) {
      const recovered = await attemptSeparateAudioRecovery(page, reelPaths, source, meta, manifest);
      meta = recovered.meta;
      audioInputPath = recovered.audioInputPath;
      await saveManifest(reelPaths, manifest);
    }

    if (await fileExists(audioInputPath)) {
      try {
        await extractAudio(audioInputPath, reelPaths.audioPath);
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
    await cleanupTempMediaFiles(reelPaths);
    finalizeManifest(manifest);
    await saveManifest(reelPaths, manifest);
    await page.close().catch(() => {});
  }
}

/**
 * Run the full pipeline for a provided set of Reel URLs.
 * @param {string[]} inputUrls
 * @param {{ label?: string }} [options]
 * @returns {Promise<{ total: number, errorCount: number }>}
 */
export async function runPipelineForUrls(inputUrls, options = {}) {
  // Compliance note: this pipeline intentionally processes only user-supplied URLs.
  await ensureProjectDirectories();
  const urls = Array.from(
    new Set(
      (Array.isArray(inputUrls) ? inputUrls : [])
        .map((url) => (typeof url === 'string' ? url.trim() : ''))
        .filter(Boolean)
    )
  );

  if (urls.length === 0) {
    log.warn('No Reel URLs were supplied to the pipeline.', { label: options.label ?? 'default' });
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
    log.info('Pipeline complete.', { total: urls.length, errorCount, label: options.label ?? 'default' });
    return { total: urls.length, errorCount };
  } finally {
    await closeBrowserContext(session);
  }
}

/**
 * Run the full pipeline for every URL in data/input/reels.txt.
 * @returns {Promise<{ total: number, errorCount: number }>}
 */
export async function runPipeline() {
  const urls = await loadInputReelUrls(INPUT_REELS_PATH);
  return runPipelineForUrls(urls, { label: 'input-file' });
}
