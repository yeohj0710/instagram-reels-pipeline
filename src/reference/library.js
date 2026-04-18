import path from 'node:path';

import { LIBRARIES_DIR, REELS_DIR, buildReelPaths } from '../storage/paths.js';
import { ensureDir, listDirectories, readJson, writeJson, writeJsonl } from '../utils/fs.js';

function buildReferenceValueScore(signals, portability) {
  return Math.round((Number(signals?.performanceScore ?? 0) * 0.35) + (Number(portability?.portabilityScore ?? 0) * 0.65));
}

/**
 * Rebuild aggregate hook/body/cta libraries from analyzed references.
 * @returns {Promise<{ referenceCount: number }>}
 */
export async function rebuildLibraries() {
  await ensureDir(LIBRARIES_DIR);

  const reelDirs = await listDirectories(REELS_DIR);
  const hooks = [];
  const bodies = [];
  const ctas = [];
  const visualPatterns = [];
  const editingPatterns = [];
  const portabilityRows = [];
  const rankedReferences = [];

  for (const reelDir of reelDirs) {
    const reelId = path.basename(reelDir);
    const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);

    const [meta, signals, structure, portability] = await Promise.all([
      readJson(reelPaths.metaPath, null),
      readJson(reelPaths.signalsPath, null),
      readJson(reelPaths.structurePath, null),
      readJson(reelPaths.portabilityPath, null)
    ]);

    if (!meta || !signals || !structure || !portability) {
      continue;
    }

    const referenceValueScore = buildReferenceValueScore(signals, portability);

    hooks.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      ...structure.hook
    });
    bodies.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      ...structure.body
    });
    ctas.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      ...structure.cta
    });
    visualPatterns.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      ...structure.visuals
    });
    editingPatterns.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      ...structure.editing
    });
    portabilityRows.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      reproducibilityCost: portability.reproducibilityCost ?? null,
      reusable: portability.reuse?.reusable ?? [],
      avoid: portability.reuse?.avoid ?? [],
      reasons: portability.reasons ?? {}
    });
    rankedReferences.push({
      referenceId: reelId,
      author: meta.author ?? null,
      performanceScore: signals.performanceScore ?? 0,
      portabilityScore: portability.portabilityScore ?? 0,
      portabilityLabel: portability.portabilityLabel ?? null,
      reproducibilityCost: portability.reproducibilityCost ?? null,
      referenceValueScore,
      caption: meta.caption ?? null,
      hook: structure.hook?.text ?? null,
      cta: structure.cta?.text ?? null,
      contentArchetype: structure.contentArchetype ?? null,
      reusable: portability.reuse?.reusable ?? [],
      avoid: portability.reuse?.avoid ?? []
    });
  }

  rankedReferences.sort((left, right) => (right.referenceValueScore ?? 0) - (left.referenceValueScore ?? 0));

  await Promise.all([
    writeJsonl(path.join(LIBRARIES_DIR, 'hooks.jsonl'), hooks),
    writeJsonl(path.join(LIBRARIES_DIR, 'bodies.jsonl'), bodies),
    writeJsonl(path.join(LIBRARIES_DIR, 'ctas.jsonl'), ctas),
    writeJsonl(path.join(LIBRARIES_DIR, 'visual_patterns.jsonl'), visualPatterns),
    writeJsonl(path.join(LIBRARIES_DIR, 'editing_patterns.jsonl'), editingPatterns),
    writeJsonl(path.join(LIBRARIES_DIR, 'portability.jsonl'), portabilityRows),
    writeJson(path.join(LIBRARIES_DIR, 'ranked_references.json'), {
      generatedAt: new Date().toISOString(),
      items: rankedReferences
    }),
    writeJson(path.join(LIBRARIES_DIR, 'portable_references.json'), {
      generatedAt: new Date().toISOString(),
      items: rankedReferences.filter((item) => item.portabilityLabel === 'portable')
    }),
    writeJson(path.join(LIBRARIES_DIR, 'conditional_references.json'), {
      generatedAt: new Date().toISOString(),
      items: rankedReferences.filter((item) => item.portabilityLabel === 'conditional')
    }),
    writeJson(path.join(LIBRARIES_DIR, 'non_portable_references.json'), {
      generatedAt: new Date().toISOString(),
      items: rankedReferences.filter((item) => item.portabilityLabel === 'non_portable')
    })
  ]);

  return {
    referenceCount: rankedReferences.length
  };
}
