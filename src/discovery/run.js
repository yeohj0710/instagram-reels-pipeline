import path from 'node:path';

import { env } from '../config/env.js';
import { closeBrowserContext, launchBrowserContext, saveStorageState } from '../scraper/browser.js';
import {
  DISCOVERY_RUNS_DIR,
  buildDiscoveryRunPaths,
  ensureProjectDirectories,
  INPUT_CREATORS_PATH,
  INPUT_KEYWORDS_PATH
} from '../storage/paths.js';
import {
  appendJsonl,
  createTimestampId,
  listDirectories,
  normalizeLineEndings,
  readJson,
  readJsonl,
  readTextFile,
  writeJson,
  writeJsonl
} from '../utils/fs.js';
import { log } from '../utils/log.js';
import { normalizeWhitespace } from '../utils/text.js';
import { rankDiscoveryCandidates, scoreDiscoveryCandidate } from './ranking.js';
import { buildDiscoverySources, discoverSourceCandidates } from './search.js';

function parseKeywordLines(content) {
  return normalizeLineEndings(content)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function parseInstagramUsername(value) {
  const raw = String(value ?? '').trim();

  if (!raw) {
    return null;
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);

      if (!/instagram\.com$/i.test(url.hostname) && !/\.instagram\.com$/i.test(url.hostname)) {
        return null;
      }

      const parts = url.pathname.split('/').filter(Boolean);
      const username = parts[0];

      if (!username || ['reel', 'reels', 'p', 'tv', 'explore'].includes(username.toLowerCase())) {
        return null;
      }

      return username.replace(/^@/, '').trim() || null;
    } catch {
      return null;
    }
  }

  const normalized = raw.replace(/^@/, '').trim();
  return /^[a-z0-9._]+$/i.test(normalized) ? normalized : null;
}

function normalizeCreatorSeed(input, index = 0) {
  if (typeof input === 'string') {
    const username = parseInstagramUsername(input);

    if (!username) {
      return null;
    }

    return {
      id: `creator-${index + 1}`,
      username,
      profileUrl: `https://www.instagram.com/${username}/`,
      niche: username,
      priority: 1
    };
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const username =
    parseInstagramUsername(input.username) ??
    parseInstagramUsername(input.url) ??
    parseInstagramUsername(input.profileUrl);

  if (!username) {
    return null;
  }

  return {
    id: input.id ?? `creator-${index + 1}`,
    username,
    profileUrl: typeof input.profileUrl === 'string' && input.profileUrl.trim()
      ? input.profileUrl.trim()
      : typeof input.url === 'string' && input.url.trim()
        ? input.url.trim()
        : `https://www.instagram.com/${username}/`,
    niche: typeof input.niche === 'string' && input.niche.trim() ? input.niche.trim() : username,
    priority: Number.isFinite(input.priority) ? input.priority : 1,
    label: typeof input.label === 'string' && input.label.trim() ? input.label.trim() : username,
    maxReels: Number.isFinite(input.maxReels) ? input.maxReels : null
  };
}

function dedupeCreators(creators) {
  const deduped = new Map();

  for (const creator of creators) {
    if (!creator?.username) {
      continue;
    }

    deduped.set(creator.username.toLowerCase(), {
      ...creator
    });
  }

  return Array.from(deduped.values());
}

function buildDiscoveryConfig() {
  return {
    maxScrollsPerSource: env.DISCOVERY_MAX_SCROLLS_PER_SOURCE,
    maxCandidatesPerKeyword: env.DISCOVERY_MAX_CANDIDATES_PER_KEYWORD,
    maxReelsPerCreator: env.DISCOVERY_MAX_REELS_PER_CREATOR,
    maxCandidatesTotal: env.DISCOVERY_MAX_CANDIDATES_TOTAL,
    softLimitMinutes: env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES
  };
}

function mergeDiscoveryCandidate(existing, candidate) {
  if (!existing) {
    return {
      ...candidate,
      sources: [
        {
          sourceId: candidate.sourceId ?? null,
          sourceType: candidate.sourceType ?? null,
          sourceLabel: candidate.sourceLabel ?? null
        }
      ]
    };
  }

  const sources = Array.isArray(existing.sources) ? existing.sources : [];
  const incomingSourceId = candidate.sourceId ?? null;
  const nextSources = incomingSourceId && sources.some((item) => item.sourceId === incomingSourceId)
    ? sources
    : [
        ...sources,
        {
          sourceId: incomingSourceId,
          sourceType: candidate.sourceType ?? null,
          sourceLabel: candidate.sourceLabel ?? null
        }
      ];

  return {
    ...existing,
    ...candidate,
    rawText: normalizeWhitespace(`${existing.rawText ?? ''} ${candidate.rawText ?? ''}`),
    metricsText: [...new Set([...(existing.metricsText ?? []), ...(candidate.metricsText ?? [])])],
    captionSnippet: existing.captionSnippet ?? candidate.captionSnippet,
    discoveredAt: existing.discoveredAt ?? candidate.discoveredAt ?? null,
    sources: nextSources
  };
}

function buildRankedCandidates(candidateMap) {
  return rankDiscoveryCandidates(Array.from(candidateMap.values()).map(scoreDiscoveryCandidate));
}

async function writeRankedSnapshot(runPaths, runId, candidateMap, extra = {}) {
  const scoredCandidates = buildRankedCandidates(candidateMap);

  await writeJson(runPaths.rankedPath, {
    runId,
    generatedAt: new Date().toISOString(),
    totalCandidates: scoredCandidates.length,
    items: scoredCandidates,
    ...extra
  });

  return scoredCandidates;
}

function isSoftLimitReached(startedAtMs) {
  if (!env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES || env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES <= 0) {
    return false;
  }

  const elapsedMs = Date.now() - startedAtMs;
  return elapsedMs >= env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES * 60_000;
}

async function loadResumeState(runPaths) {
  const [state, rows] = await Promise.all([
    readJson(runPaths.statePath, null),
    readJsonl(runPaths.candidatesPath).catch(() => [])
  ]);
  const candidateMap = new Map();

  for (const row of rows) {
    if (!row || typeof row !== 'object' || !row.url) {
      continue;
    }

    candidateMap.set(row.url, mergeDiscoveryCandidate(candidateMap.get(row.url), row));
  }

  return {
    state: state && typeof state === 'object' ? state : null,
    candidateMap,
    visitedSourceIds: new Set(Array.isArray(state?.visitedSourceIds) ? state.visitedSourceIds : [])
  };
}

/**
 * Load configured keywords from disk.
 * @returns {Promise<string[]>}
 */
export async function loadDiscoveryKeywords() {
  const content = await readTextFile(INPUT_KEYWORDS_PATH).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  });

  return parseKeywordLines(content);
}

/**
 * Load creator seeds from disk and normalize profile URLs/usernames.
 * @param {Array<string | Record<string, unknown>>} [extraSeeds]
 * @returns {Promise<Array<{ username: string, niche?: string, priority?: number, profileUrl?: string }>>}
 */
export async function loadCreatorSeeds(extraSeeds = []) {
  const creators = await readJson(INPUT_CREATORS_PATH, []);
  const combined = [
    ...(Array.isArray(creators) ? creators : []),
    ...(Array.isArray(extraSeeds) ? extraSeeds : [])
  ];

  return dedupeCreators(
    combined
      .map((creator, index) => normalizeCreatorSeed(creator, index))
      .filter(Boolean)
  );
}

/**
 * Return the newest discovery run directory.
 * @returns {Promise<string | null>}
 */
export async function getLatestDiscoveryRunId() {
  const directories = await listDirectories(DISCOVERY_RUNS_DIR);

  if (directories.length === 0) {
    return null;
  }

  return path.basename(directories.sort().at(-1));
}

/**
 * Run a budgeted, seed-based discovery pass with checkpointing and resume support.
 * Compliance note: discovery is limited to explicit user-provided keywords and creator seeds.
 * @param {{ runId?: string | null, resume?: boolean, maxSources?: number | null, creatorSeeds?: Array<string | Record<string, unknown>>, creatorOnly?: boolean }} [options]
 * @returns {Promise<{ runId: string, candidateCount: number, processedSources: number, totalSources: number, errorCount: number, completed: boolean }>}
 */
export async function runDiscovery(options = {}) {
  await ensureProjectDirectories();

  const fileKeywords = await loadDiscoveryKeywords();
  const keywords = options.creatorOnly ? [] : fileKeywords;
  const creators = await loadCreatorSeeds(options.creatorSeeds);

  if (keywords.length === 0 && creators.length === 0) {
    throw new Error('No discovery seeds found. Add keywords.txt or creators.json entries first.');
  }

  const latestRunId = options.resume && !options.runId ? await getLatestDiscoveryRunId() : null;
  const resumeRunId = options.runId ?? latestRunId ?? null;
  const runId = resumeRunId ?? createTimestampId();
  const runPaths = buildDiscoveryRunPaths(runId);
  const sources = buildDiscoverySources(keywords, creators);
  const config = buildDiscoveryConfig();
  const resumeState = resumeRunId ? await loadResumeState(runPaths) : { state: null, candidateMap: new Map(), visitedSourceIds: new Set() };

  if (options.runId && !resumeState.state) {
    throw new Error(`Discovery run ${options.runId} was not found.`);
  }

  if (!resumeState.state) {
    await writeJson(runPaths.runPath, {
      runId,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      keywords,
      creators,
      sourceCount: sources.length,
      processedSources: 0,
      errorCount: 0,
      completed: false,
      config
    });
    await writeJsonl(runPaths.frontierPath, sources);
    await writeJson(runPaths.statePath, {
      runId,
      updatedAt: new Date().toISOString(),
      processedSources: 0,
      visitedSourceIds: [],
      candidateCount: 0,
      errorCount: 0,
      completed: false
    });
  } else {
    await writeJson(runPaths.runPath, {
      ...resumeState.state,
      runId,
      resumedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'running',
      keywords,
      creators,
      sourceCount: sources.length,
      errorCount: resumeState.state?.errorCount ?? 0,
      config
    });
  }

  const candidateMap = resumeState.candidateMap;
  const visitedSourceIds = resumeState.visitedSourceIds;
  const remainingSources = sources.filter((source) => !visitedSourceIds.has(source.id));
  const limitedSources =
    Number.isFinite(options.maxSources) && options.maxSources > 0
      ? remainingSources.slice(0, options.maxSources)
      : remainingSources;

  if (limitedSources.length === 0) {
    const rankedExisting = await writeRankedSnapshot(runPaths, runId, candidateMap, {
      status: 'complete',
      completed: true
    });

    await writeJson(runPaths.statePath, {
      runId,
      updatedAt: new Date().toISOString(),
      processedSources: visitedSourceIds.size,
      visitedSourceIds: Array.from(visitedSourceIds),
      candidateCount: candidateMap.size,
      errorCount: resumeState.state?.errorCount ?? 0,
      completed: true
    });

    await writeJson(runPaths.runPath, {
      ...(await readJson(runPaths.runPath, {})),
      runId,
      updatedAt: new Date().toISOString(),
      status: 'complete',
      processedSources: visitedSourceIds.size,
      sourceCount: sources.length,
      errorCount: resumeState.state?.errorCount ?? 0,
      completed: true
    });

    return {
      runId,
      candidateCount: rankedExisting.length,
      processedSources: visitedSourceIds.size,
      totalSources: sources.length,
      errorCount: resumeState.state?.errorCount ?? 0,
      completed: true
    };
  }

  const session = await launchBrowserContext({
    headless: env.PLAYWRIGHT_HEADLESS,
    requireAuth: true
  });
  const startedAtMs = Date.now();
  let processedThisPass = 0;
  let errorCount = Number(resumeState.state?.errorCount ?? 0) || 0;
  let completed = true;

  try {
    log.info('Starting discovery run.', {
      runId,
      keywordCount: keywords.length,
      creatorCount: creators.length,
      remainingSources: remainingSources.length,
      candidateCount: candidateMap.size
    });

    for (const source of limitedSources) {
      if (candidateMap.size >= env.DISCOVERY_MAX_CANDIDATES_TOTAL) {
        completed = false;
        log.warn('Stopping discovery due to total candidate budget.', {
          runId,
          candidateCount: candidateMap.size,
          maxCandidatesTotal: env.DISCOVERY_MAX_CANDIDATES_TOTAL
        });
        break;
      }

      if (isSoftLimitReached(startedAtMs)) {
        completed = false;
        log.warn('Stopping discovery due to soft runtime limit.', {
          runId,
          softLimitMinutes: env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES
        });
        break;
      }

      log.info('Scanning discovery source.', {
        runId,
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        progress: `${visitedSourceIds.size + 1}/${sources.length}`
      });

      let discovered = [];

      try {
        discovered = await discoverSourceCandidates(session.context, source, {
          maxScrolls: env.DISCOVERY_MAX_SCROLLS_PER_SOURCE,
          maxCandidatesPerKeyword: env.DISCOVERY_MAX_CANDIDATES_PER_KEYWORD,
          maxReelsPerCreator: env.DISCOVERY_MAX_REELS_PER_CREATOR
        });
      } catch (error) {
        errorCount += 1;

        await appendJsonl(runPaths.visitedPath, {
          kind: 'source_error',
          sourceId: source.id,
          sourceType: source.sourceType,
          sourceLabel: source.sourceLabel,
          failedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : String(error)
        });

        log.warn('Discovery source failed; continuing.', {
          runId,
          sourceId: source.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      for (const candidate of discovered) {
        const candidateWithSource = {
          ...candidate,
          sourceId: source.id
        };

        candidateMap.set(
          candidate.url,
          mergeDiscoveryCandidate(candidateMap.get(candidate.url), candidateWithSource)
        );

        await appendJsonl(runPaths.candidatesPath, candidateWithSource);
        await appendJsonl(runPaths.visitedPath, {
          kind: 'candidate',
          sourceId: source.id,
          url: candidate.url,
          shortcode: candidate.url.split('/').filter(Boolean).at(-1) ?? null,
          visitedAt: new Date().toISOString()
        });
      }

      visitedSourceIds.add(source.id);
      processedThisPass += 1;

      await appendJsonl(runPaths.visitedPath, {
        kind: 'source',
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        visitedAt: new Date().toISOString(),
        discoveredCount: discovered.length
      });

      const rankedCandidates = await writeRankedSnapshot(runPaths, runId, candidateMap, {
        status: 'running',
        completed: false,
        processedSources: visitedSourceIds.size,
        sourceCount: sources.length
      });

      await writeJson(runPaths.statePath, {
        runId,
        updatedAt: new Date().toISOString(),
        processedSources: visitedSourceIds.size,
        visitedSourceIds: Array.from(visitedSourceIds),
        candidateCount: rankedCandidates.length,
        lastSourceId: source.id,
        errorCount,
        completed: false
      });

      await writeJson(runPaths.runPath, {
        ...(await readJson(runPaths.runPath, {})),
        runId,
        updatedAt: new Date().toISOString(),
        status: 'running',
        processedSources: visitedSourceIds.size,
        sourceCount: sources.length,
        errorCount,
        completed: false,
        lastSourceId: source.id
      });
    }

    const allSourcesProcessed = visitedSourceIds.size >= sources.length;
    const finalCompleted = completed && allSourcesProcessed;
    const rankedCandidates = await writeRankedSnapshot(runPaths, runId, candidateMap, {
      status: finalCompleted ? 'complete' : 'partial',
      completed: finalCompleted,
      processedSources: visitedSourceIds.size,
      sourceCount: sources.length
    });

    await writeJson(runPaths.statePath, {
      runId,
      updatedAt: new Date().toISOString(),
      processedSources: visitedSourceIds.size,
      visitedSourceIds: Array.from(visitedSourceIds),
      candidateCount: rankedCandidates.length,
      completed: finalCompleted
    });

    await writeJson(runPaths.runPath, {
      ...(await readJson(runPaths.runPath, {})),
      runId,
      updatedAt: new Date().toISOString(),
      status: finalCompleted ? 'complete' : 'partial',
      processedSources: visitedSourceIds.size,
      sourceCount: sources.length,
      errorCount,
      completed: finalCompleted
    });

    await saveStorageState(session.context);

    log.info('Discovery run complete.', {
      runId,
      candidateCount: rankedCandidates.length,
      processedSources: visitedSourceIds.size,
      totalSources: sources.length,
      errorCount,
      completed: finalCompleted,
      processedThisPass
    });

    return {
      runId,
      candidateCount: rankedCandidates.length,
      processedSources: visitedSourceIds.size,
      totalSources: sources.length,
      completed: finalCompleted
    };
  } finally {
    await closeBrowserContext(session);
  }
}
