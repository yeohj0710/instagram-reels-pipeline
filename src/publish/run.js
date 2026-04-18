import path from 'node:path';

import { buildReelPaths, ensureProjectDirectories, LIBRARIES_DIR, PUBLISH_NOTION_DIR } from '../storage/paths.js';
import { getLatestPlanningRunId, loadPlanningScripts } from '../planning/runs.js';
import { readJson, readTextFile, writeJson } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { upsertNotionPlans, upsertNotionReferences } from './notion.js';

async function loadReferenceExports(limit = 100) {
  const ranked = await readJson(path.join(LIBRARIES_DIR, 'ranked_references.json'), { items: [] });
  const items = Array.isArray(ranked.items) ? ranked.items.slice(0, limit) : [];
  const references = [];

  for (const item of items) {
    const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${item.referenceId}/`);
    const [meta, signals, structure, markdown] = await Promise.all([
      readJson(reelPaths.metaPath, {}),
      readJson(reelPaths.signalsPath, {}),
      readJson(reelPaths.structurePath, {}),
      readTextFile(reelPaths.summaryPath).catch(() => '')
    ]);

    references.push({
      syncKey: item.referenceId,
      referenceId: item.referenceId,
      author: meta.author ?? item.author ?? null,
      caption: meta.caption ?? item.caption ?? null,
      performanceScore: signals.performanceScore ?? item.performanceScore ?? 0,
      hook: structure.hook?.text ?? item.hook ?? null,
      cta: structure.cta?.text ?? item.cta ?? null,
      contentArchetype: structure.contentArchetype ?? item.contentArchetype ?? null,
      hashtags: signals.hashtags ?? [],
      url: meta.finalUrl ?? meta.url ?? `https://www.instagram.com/reels/${item.referenceId}/`,
      markdown
    });
  }

  return references;
}

/**
 * Export the latest planning run for downstream publishing and optionally sync to Notion.
 * @param {{ runId?: string | null, referenceLimit?: number | null }} [options]
 * @returns {Promise<{ runId: string, scriptCount: number, referenceCount: number, notion: Record<string, unknown> }>}
 */
export async function runPublish(options = {}) {
  await ensureProjectDirectories();

  const runId = options.runId ?? (await getLatestPlanningRunId());

  if (!runId) {
    throw new Error('No planning run found. Run "npm run generate" first.');
  }

  const scripts = (await loadPlanningScripts(runId)).map((script) => ({
    syncKey: script.scriptId,
    status: 'Ready',
    sourceUrl:
      Array.isArray(script.sourceReferences) && script.sourceReferences[0]
        ? `https://www.instagram.com/reels/${script.sourceReferences[0]}/`
        : null,
    keywords: script.keywords ?? [],
    ...script
  }));
  const references = await loadReferenceExports(
    Number.isFinite(options.referenceLimit) && options.referenceLimit > 0 ? options.referenceLimit : 100
  );

  await writeJson(path.join(PUBLISH_NOTION_DIR, `${runId}-export.json`), {
    runId,
    exportedAt: new Date().toISOString(),
    scripts,
    references
  });

  const notion = {
    plans: await upsertNotionPlans(scripts),
    references: await upsertNotionReferences(references)
  };

  await writeJson(path.join(PUBLISH_NOTION_DIR, `${runId}-publish.json`), {
    runId,
    publishedAt: new Date().toISOString(),
    notion
  });

  log.info('Publish step complete.', {
    runId,
    scriptCount: scripts.length,
    referenceCount: references.length,
    notionPlansEnabled: notion.plans.enabled,
    notionReferencesEnabled: notion.references.enabled
  });

  return {
    runId,
    scriptCount: scripts.length,
    referenceCount: references.length,
    notion
  };
}
