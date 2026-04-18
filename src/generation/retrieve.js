import path from 'node:path';

import { LIBRARIES_DIR, buildReelPaths } from '../storage/paths.js';
import { readJson } from '../utils/fs.js';
import { scoreKeywordMatch } from '../utils/text.js';

function pickCandidatePool(items, allowedLabels) {
  const preferred = items.filter((item) => allowedLabels.includes(item.portabilityLabel));

  if (preferred.length > 0) {
    return preferred;
  }

  const fallbackConditional = items.filter((item) => item.portabilityLabel === 'conditional');

  if (fallbackConditional.length > 0) {
    return fallbackConditional;
  }

  return items;
}

/**
 * Retrieve and rank references for a generation brief.
 * @param {{ keywords: string[], referenceCount: number, allowedPortabilityLabels?: string[], minimumPortabilityScore?: number }} brief
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function retrieveReferenceCandidates(brief) {
  const ranked = await readJson(path.join(LIBRARIES_DIR, 'ranked_references.json'), { items: [] });
  const items = Array.isArray(ranked.items) ? ranked.items : [];
  const keywords = Array.isArray(brief.keywords) ? brief.keywords : [];
  const allowedLabels =
    Array.isArray(brief.allowedPortabilityLabels) && brief.allowedPortabilityLabels.length > 0
      ? brief.allowedPortabilityLabels
      : ['portable', 'conditional'];
  const minimumPortabilityScore =
    Number.isFinite(brief.minimumPortabilityScore) && brief.minimumPortabilityScore > 0
      ? brief.minimumPortabilityScore
      : 40;
  const portabilityFiltered = items.filter((item) => (item.portabilityScore ?? 0) >= minimumPortabilityScore);
  const filteredItems = pickCandidatePool(portabilityFiltered.length > 0 ? portabilityFiltered : items, allowedLabels);

  const scored = [];

  for (const item of filteredItems) {
    const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${item.referenceId}/`);
    const [meta, structure, signals, portability] = await Promise.all([
      readJson(reelPaths.metaPath, {}),
      readJson(reelPaths.structurePath, {}),
      readJson(reelPaths.signalsPath, {}),
      readJson(reelPaths.portabilityPath, {})
    ]);

    const keywordScore = Math.max(
      0,
      ...keywords.map((keyword) =>
        scoreKeywordMatch(keyword, [meta.caption ?? '', structure.hook?.text ?? '', item.hook ?? ''])
      )
    );
    const portabilityScore = portability.portabilityScore ?? item.portabilityScore ?? 0;
    const labelBonus =
      (portability.portabilityLabel ?? item.portabilityLabel) === 'portable'
        ? 12
        : (portability.portabilityLabel ?? item.portabilityLabel) === 'conditional'
          ? 4
          : -20;

    scored.push({
      referenceId: item.referenceId,
      author: meta.author ?? item.author ?? null,
      caption: meta.caption ?? item.caption ?? null,
      performanceScore: signals.performanceScore ?? item.performanceScore ?? 0,
      portabilityScore,
      portabilityLabel: portability.portabilityLabel ?? item.portabilityLabel ?? null,
      reusable: portability.reuse?.reusable ?? item.reusable ?? [],
      avoid: portability.reuse?.avoid ?? item.avoid ?? [],
      keywordScore,
      combinedScore: Math.round(
        portabilityScore * 0.5 +
          (signals.performanceScore ?? item.performanceScore ?? 0) * 0.2 +
          keywordScore * 0.3 +
          labelBonus
      ),
      structure,
      signals,
      portability
    });
  }

  return scored
    .sort((left, right) => (right.combinedScore ?? 0) - (left.combinedScore ?? 0))
    .slice(0, brief.referenceCount);
}
