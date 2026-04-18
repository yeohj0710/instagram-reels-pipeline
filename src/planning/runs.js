import path from 'node:path';

import { PLANNING_RUNS_DIR, buildPlanningRunPaths } from '../storage/paths.js';
import { listDirectories, listFiles, readJson, readTextFile } from '../utils/fs.js';

/**
 * Return the most recent planning run id.
 * @returns {Promise<string | null>}
 */
export async function getLatestPlanningRunId() {
  const directories = await listDirectories(PLANNING_RUNS_DIR);

  if (directories.length === 0) {
    return null;
  }

  return path.basename(directories.sort().at(-1));
}

/**
 * Load generated planning scripts for a run.
 * @param {string} runId
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function loadPlanningScripts(runId) {
  const runPaths = buildPlanningRunPaths(runId);
  const files = (await listFiles(runPaths.scriptsDir)).filter((filePath) => filePath.endsWith('.json')).sort();
  const scripts = [];

  for (const filePath of files) {
    const script = await readJson(filePath, null);

    if (!script || typeof script !== 'object') {
      continue;
    }

    const markdownPath = filePath.replace(/\.json$/i, '.md');
    const markdown = await readTextFile(markdownPath).catch(() => '');

    scripts.push({
      ...script,
      jsonPath: filePath,
      markdownPath,
      markdown
    });
  }

  return scripts;
}
