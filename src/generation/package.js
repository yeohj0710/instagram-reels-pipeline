import path from 'node:path';

import { buildReelPaths } from '../storage/paths.js';
import { listFiles } from '../utils/fs.js';

async function pickReferenceAssets(referenceId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${referenceId}/`);
  const frameFiles = (await listFiles(reelPaths.framesDir))
    .filter((filePath) => /\.jpe?g$/i.test(filePath))
    .sort()
    .slice(0, 3);

  return {
    referenceId,
    reelDir: reelPaths.reelDir,
    metaPath: reelPaths.metaPath,
    summaryPath: reelPaths.summaryPath,
    structurePath: reelPaths.structurePath,
    transcriptPath: reelPaths.transcriptTextPath,
    framesDir: reelPaths.framesDir,
    frameSamples: frameFiles
  };
}

/**
 * Build a shoot-ready production package for one generated script.
 * @param {Record<string, unknown>} script
 * @param {Record<string, unknown>[]} references
 * @returns {Promise<Record<string, unknown>>}
 */
export async function buildProductionPackage(script, references) {
  const sourceReferences = Array.isArray(script.sourceReferences) ? script.sourceReferences : [];
  const selectedReferenceIds = sourceReferences.slice(0, 5);
  const referenceLookup = new Map(references.map((reference) => [reference.referenceId, reference]));
  const referenceAssets = [];

  for (const referenceId of selectedReferenceIds) {
    const reference = referenceLookup.get(referenceId);
    const assets = await pickReferenceAssets(referenceId);

    referenceAssets.push({
      referenceId,
      author: reference?.author ?? null,
      performanceScore: reference?.performanceScore ?? 0,
      portabilityScore: reference?.portabilityScore ?? 0,
      portabilityLabel: reference?.portabilityLabel ?? null,
      hook: reference?.structure?.hook?.text ?? null,
      cta: reference?.structure?.cta?.text ?? null,
      contentArchetype: reference?.structure?.contentArchetype ?? reference?.contentArchetype ?? null,
      ...assets
    });
  }

  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  const primaryReference = referenceAssets[0] ?? null;

  return {
    scriptId: script.scriptId,
    title: script.title,
    campaignId: script.campaignId,
    profileId: script.profileId,
    generatedAt: script.generatedAt ?? new Date().toISOString(),
    objective: script.objective,
    targetPersona: script.targetPersona,
    assemblyMode: script.assemblyMode ?? 'unknown',
    transformationIntensity: script.transformationIntensity ?? 'unknown',
    keywords: script.keywords ?? [],
    shootBrief: {
      hook: script.hook,
      bodySummary: script.bodySummary,
      cta: script.cta,
      recommendedDuration: scenes.at(-1)?.timing ?? '0-30s',
      visualAnchorReference: primaryReference?.referenceId ?? null
    },
    scenePlan: scenes.map((scene, index) => ({
      shotNumber: index + 1,
      timing: scene.timing,
      goal: scene.goal,
      delivery: scene.script,
      subtitle: scene.subtitle,
      camera: scene.camera,
      visualReference: scene.visualReference,
      mustCapture: Array.isArray(scene.assets) ? scene.assets : [],
      referenceFramePath: primaryReference?.frameSamples?.[Math.min(index, (primaryReference.frameSamples?.length ?? 1) - 1)] ?? null,
      sourceReferenceId: scene.sourceReferenceId ?? null,
      sourceSection: scene.sourceSection ?? null
    })),
    editingBlueprint: {
      guide: Array.isArray(script.editingGuide) ? script.editingGuide : [],
      captionDraft: script.captionDraft ?? '',
      assetChecklist: Array.isArray(script.assetChecklist) ? script.assetChecklist : [],
      humanEditableFields: Array.isArray(script.humanEditableFields) ? script.humanEditableFields : []
    },
    productionChecklist: {
      preShoot: [
        'Read the source reference summaries before filming.',
        'Lock the hook wording and subtitle emphasis before recording.',
        'Prepare any B-roll, screenshots, or proof assets listed in the scene plan.'
      ],
      onShoot: [
        'Record the hook first until pacing matches the reference intent.',
        'Capture one clean primary take per scene plus one faster alternate.',
        'Match camera distance and emphasis beats to the linked reference frames.'
      ],
      postShoot: [
        'Edit in the same order as the scene plan.',
        'Keep subtitles aligned with the hook and CTA wording.',
        'Review every claim against the harvested reference bundle before publishing.'
      ]
    },
    provenance: script.provenance ?? null,
    referenceAssets,
    humanReviewQuestions: [
      'Is the hook still clearly grounded in the selected references?',
      'Did any claim drift beyond what the references support?',
      'Does the CTA fit the creator identity and target persona?',
      'Would a human shooter know exactly what to say and show from this package?'
    ]
  };
}
