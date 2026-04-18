/**
 * Convert one generated script JSON into a readable markdown plan.
 * @param {Record<string, unknown>} script
 * @returns {string}
 */
export function renderScriptMarkdown(script) {
  const scenes = Array.isArray(script.scenes) ? script.scenes : [];
  const referenceLines = Array.isArray(script.sourceReferences) ? script.sourceReferences.map((item) => `- ${item}`).join('\n') : '- None';
  const sceneLines = scenes
    .map(
      (scene, index) =>
        `### Scene ${index + 1} (${scene.timing})\n- Goal: ${scene.goal}\n- Script: ${scene.script}\n- Camera: ${scene.camera}\n- Visual reference: ${scene.visualReference}\n- Subtitle: ${scene.subtitle}\n- Assets: ${(scene.assets ?? []).join(', ') || 'None'}\n- Source reference: ${scene.sourceReferenceId ?? 'None'}\n- Source section: ${scene.sourceSection ?? 'None'}`
    )
    .join('\n\n');

  const editingLines = Array.isArray(script.editingGuide)
    ? script.editingGuide.map((item) => `- ${item}`).join('\n')
    : '- None';

  const assetLines = Array.isArray(script.assetChecklist)
    ? script.assetChecklist.map((item) => `- ${item}`).join('\n')
    : '- None';

  const editableLines = Array.isArray(script.humanEditableFields)
    ? script.humanEditableFields.map((item) => `- ${item}`).join('\n')
    : '- None';
  const provenanceLines = script.provenance
    ? `- Hook ref: ${script.provenance.hookReferenceId}\n- Body ref: ${script.provenance.bodyReferenceId}\n- CTA ref: ${script.provenance.ctaReferenceId}\n- Editing ref: ${script.provenance.editingReferenceId}\n${(script.provenance.notes ?? []).map((item) => `- ${item}`).join('\n')}`
    : '- None';

  return `# ${script.title}\n\n## Objective\n${script.objective}\n\n## Persona\n${script.targetPersona}\n\n## Assembly\n- Mode: ${script.assemblyMode ?? 'unknown'}\n- Transformation intensity: ${script.transformationIntensity ?? 'unknown'}\n\n## Source References\n${referenceLines}\n\n## Hook\n${script.hook}\n\n## CTA\n${script.cta}\n\n## Scenes\n${sceneLines}\n\n## Editing Guide\n${editingLines}\n\n## Asset Checklist\n${assetLines}\n\n## Caption Draft\n${script.captionDraft}\n\n## Human Editable Fields\n${editableLines}\n\n## Provenance\n${provenanceLines}\n`;
}

/**
 * Convert one production package into a shoot-ready markdown guide.
 * @param {Record<string, unknown>} pack
 * @returns {string}
 */
export function renderProductionMarkdown(pack) {
  const sceneLines = Array.isArray(pack.scenePlan)
    ? pack.scenePlan
        .map(
          (scene) =>
            `## Shot ${scene.shotNumber}\n- Timing: ${scene.timing}\n- Goal: ${scene.goal}\n- Delivery: ${scene.delivery}\n- Subtitle: ${scene.subtitle}\n- Camera: ${scene.camera}\n- Visual reference: ${scene.visualReference}\n- Must capture: ${(scene.mustCapture ?? []).join(', ') || 'None'}\n- Reference frame: ${scene.referenceFramePath ?? 'None'}\n- Source reference: ${scene.sourceReferenceId ?? 'None'}\n- Source section: ${scene.sourceSection ?? 'None'}`
        )
        .join('\n\n')
    : '';

  const referenceLines = Array.isArray(pack.referenceAssets)
    ? pack.referenceAssets
        .map(
          (reference) =>
            `- ${reference.referenceId} | author: ${reference.author ?? 'unknown'} | performance: ${reference.performanceScore ?? 0} | portability: ${reference.portabilityScore ?? 0} (${reference.portabilityLabel ?? 'unknown'})\n  - summary: ${reference.summaryPath ?? 'None'}\n  - frames: ${reference.framesDir ?? 'None'}`
        )
        .join('\n')
    : '- None';

  const checklistGroups = Object.entries(pack.productionChecklist ?? {})
    .map(([label, items]) => {
      const lines = Array.isArray(items) ? items.map((item) => `- ${item}`).join('\n') : '- None';
      return `## ${label}\n${lines}`;
    })
    .join('\n\n');

  const editingLines = Array.isArray(pack.editingBlueprint?.guide)
    ? pack.editingBlueprint.guide.map((item) => `- ${item}`).join('\n')
    : '- None';

  const assetLines = Array.isArray(pack.editingBlueprint?.assetChecklist)
    ? pack.editingBlueprint.assetChecklist.map((item) => `- ${item}`).join('\n')
    : '- None';
  const provenanceLines = pack.provenance
    ? `- Hook ref: ${pack.provenance.hookReferenceId}\n- Body ref: ${pack.provenance.bodyReferenceId}\n- CTA ref: ${pack.provenance.ctaReferenceId}\n- Editing ref: ${pack.provenance.editingReferenceId}\n${(pack.provenance.notes ?? []).map((item) => `- ${item}`).join('\n')}`
    : '- None';

  return `# ${pack.title}\n\n## Shoot Brief\n- Objective: ${pack.objective}\n- Persona: ${pack.targetPersona}\n- Hook: ${pack.shootBrief?.hook ?? ''}\n- CTA: ${pack.shootBrief?.cta ?? ''}\n- Duration: ${pack.shootBrief?.recommendedDuration ?? ''}\n- Assembly mode: ${pack.assemblyMode ?? 'unknown'}\n- Transformation intensity: ${pack.transformationIntensity ?? 'unknown'}\n\n## Reference Assets\n${referenceLines}\n\n${sceneLines}\n\n## Editing Blueprint\n${editingLines}\n\n## Asset Checklist\n${assetLines}\n\n## Provenance\n${provenanceLines}\n\n${checklistGroups}\n`;
}
