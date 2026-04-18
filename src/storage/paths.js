import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDir, sanitizeFileSegment } from '../utils/fs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const INPUT_DIR = path.join(DATA_DIR, 'input');
export const INPUT_REELS_PATH = path.join(INPUT_DIR, 'reels.txt');
export const INPUT_KEYWORDS_PATH = path.join(INPUT_DIR, 'keywords.txt');
export const INPUT_CREATORS_PATH = path.join(INPUT_DIR, 'creators.json');
export const INPUT_CAMPAIGNS_PATH = path.join(INPUT_DIR, 'campaigns.json');
export const AUTH_DIR = path.join(DATA_DIR, 'auth');
export const AUTH_STATE_PATH = path.join(AUTH_DIR, 'storageState.json');
export const REELS_DIR = path.join(DATA_DIR, 'reels');
export const DISCOVERY_DIR = path.join(DATA_DIR, 'discovery');
export const DISCOVERY_RUNS_DIR = path.join(DISCOVERY_DIR, 'runs');
export const LIBRARIES_DIR = path.join(DATA_DIR, 'libraries');
export const PLANNING_DIR = path.join(DATA_DIR, 'planning');
export const PLANNING_RUNS_DIR = path.join(PLANNING_DIR, 'runs');
export const PROFILES_DIR = path.join(PLANNING_DIR, 'profiles');
export const PLANS_DIR = path.join(DATA_DIR, 'plans');
export const PUBLISH_DIR = path.join(DATA_DIR, 'publish');
export const PUBLISH_NOTION_DIR = path.join(PUBLISH_DIR, 'notion');
export const PUBLISH_SCHEDULES_DIR = path.join(PUBLISH_DIR, 'schedules');

/**
 * Ensure the base project data directories exist.
 * @returns {Promise<void>}
 */
export async function ensureProjectDirectories() {
  await Promise.all([
    ensureDir(DATA_DIR),
    ensureDir(INPUT_DIR),
    ensureDir(AUTH_DIR),
    ensureDir(REELS_DIR),
    ensureDir(DISCOVERY_RUNS_DIR),
    ensureDir(LIBRARIES_DIR),
    ensureDir(PLANNING_RUNS_DIR),
    ensureDir(PROFILES_DIR),
    ensureDir(PLANS_DIR),
    ensureDir(PUBLISH_NOTION_DIR),
    ensureDir(PUBLISH_SCHEDULES_DIR)
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
 *   recordPath: string,
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
 *   manifestPath: string,
 *   analysisDir: string,
 *   signalsPath: string,
 *   structurePath: string,
 *   portabilityPath: string,
 *   hookPath: string,
 *   bodyPath: string,
 *   ctaPath: string,
 *   editingPath: string,
 *   summaryPath: string,
 *   informationPath: string,
 *   formatPath: string
 * }}
 */
export function buildReelPaths(urlString) {
  const reelId = parseShortcodeFromUrl(urlString) ?? sanitizeFileSegment(urlString, 'reel');
  const reelDir = path.join(REELS_DIR, reelId);
  const mediaDir = path.join(reelDir, 'media');
  const transcriptDir = path.join(reelDir, 'transcript');
  const analysisDir = path.join(reelDir, 'analysis');

  return {
    reelId,
    reelDir,
    recordPath: path.join(reelDir, 'record.json'),
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
    manifestPath: path.join(reelDir, 'manifest.json'),
    analysisDir,
    signalsPath: path.join(analysisDir, 'signals.json'),
    structurePath: path.join(analysisDir, 'structure.json'),
    portabilityPath: path.join(analysisDir, 'portability.json'),
    hookPath: path.join(analysisDir, 'hook.json'),
    bodyPath: path.join(analysisDir, 'body.json'),
    ctaPath: path.join(analysisDir, 'cta.json'),
    editingPath: path.join(analysisDir, 'editing.json'),
    summaryPath: path.join(analysisDir, 'summary.md'),
    informationPath: path.join(analysisDir, 'information.json'),
    formatPath: path.join(analysisDir, 'format.json')
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
    ensureDir(reelPaths.transcriptDir),
    ensureDir(reelPaths.analysisDir)
  ]);
}

/**
 * Build paths for one discovery run.
 * @param {string} runId
 * @returns {{
 *   runId: string,
 *   runDir: string,
 *   checkpointsDir: string,
 *   statePath: string,
 *   runPath: string,
 *   frontierPath: string,
 *   visitedPath: string,
 *   candidatesPath: string,
 *   rankedPath: string
 * }}
 */
export function buildDiscoveryRunPaths(runId) {
  const runDir = path.join(DISCOVERY_RUNS_DIR, runId);

  return {
    runId,
    runDir,
    checkpointsDir: path.join(runDir, 'checkpoints'),
    statePath: path.join(runDir, 'checkpoints', 'state.json'),
    runPath: path.join(runDir, 'run.json'),
    frontierPath: path.join(runDir, 'frontier.jsonl'),
    visitedPath: path.join(runDir, 'visited.jsonl'),
    candidatesPath: path.join(runDir, 'candidates.jsonl'),
    rankedPath: path.join(runDir, 'ranked.json')
  };
}

/**
 * Build paths for one planning run.
 * @param {string} runId
 * @returns {{
 *   runId: string,
 *   runDir: string,
 *   briefPath: string,
 *   candidatesPath: string,
 *   selectedRefsPath: string,
 *   scriptsDir: string,
 *   packagesDir: string,
 *   notionDir: string
 * }}
 */
export function buildPlanningRunPaths(runId) {
  const runDir = path.join(PLANNING_RUNS_DIR, runId);

  return {
    runId,
    runDir,
    briefPath: path.join(runDir, 'brief.json'),
    candidatesPath: path.join(runDir, 'candidates.json'),
    selectedRefsPath: path.join(runDir, 'selected_refs.json'),
    scriptsDir: path.join(runDir, 'scripts'),
    packagesDir: path.join(runDir, 'packages'),
    notionDir: path.join(runDir, 'notion')
  };
}

/**
 * Build paths for one saved plan.
 * @param {string} planId
 * @returns {{
 *   planId: string,
 *   planDir: string,
 *   jsonPath: string,
 *   markdownPath: string
 * }}
 */
export function buildPlanPaths(planId) {
  const planDir = path.join(PLANS_DIR, planId);

  return {
    planId,
    planDir,
    jsonPath: path.join(planDir, 'plan.json'),
    markdownPath: path.join(planDir, 'plan.md')
  };
}
