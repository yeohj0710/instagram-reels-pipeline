import path from 'node:path';

import { runPipelineForUrls } from '../main.js';
import { buildDiscoveryRunPaths, ensureProjectDirectories } from '../storage/paths.js';
import { readJson, writeJson } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { getLatestDiscoveryRunId } from './run.js';

/**
 * Harvest candidate Reel URLs from a discovery run into the local reel data lake.
 * @param {{ runId?: string | null, limit?: number | null }} [options]
 * @returns {Promise<{ runId: string, selectedCount: number, total: number, errorCount: number }>}
 */
export async function runHarvest(options = {}) {
  await ensureProjectDirectories();

  const runId = options.runId ?? (await getLatestDiscoveryRunId());

  if (!runId) {
    throw new Error('No discovery run found. Run "npm run discover" first.');
  }

  const runPaths = buildDiscoveryRunPaths(runId);
  const ranked = await readJson(runPaths.rankedPath, null);
  const items = Array.isArray(ranked?.items) ? ranked.items : [];

  if (items.length === 0) {
    throw new Error(`Discovery run ${runId} has no ranked candidates.`);
  }

  const limit = Number.isFinite(options.limit) && options.limit > 0 ? options.limit : items.length;
  const selected = items.slice(0, limit).map((item, index) => ({
    rank: index + 1,
    ...item
  }));
  const urls = selected.map((item) => item.url).filter(Boolean);

  await writeJson(path.join(runPaths.runDir, 'harvest_selection.json'), {
    runId,
    selectedAt: new Date().toISOString(),
    totalCandidates: items.length,
    selectedCount: urls.length,
    items: selected
  });

  log.info('Starting harvest from discovery run.', { runId, selectedCount: urls.length });
  const result = await runPipelineForUrls(urls, { label: `discovery:${runId}` });

  const summary = {
    runId,
    harvestedAt: new Date().toISOString(),
    selectedCount: urls.length,
    ...result
  };

  await writeJson(path.join(runPaths.runDir, 'harvest.json'), summary);
  return summary;
}
