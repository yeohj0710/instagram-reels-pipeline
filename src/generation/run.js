import path from 'node:path';

import { env } from '../config/env.js';
import { buildPlanningRunPaths, ensureProjectDirectories } from '../storage/paths.js';
import { createTimestampId, ensureDir, writeJson, writeText } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { loadCampaigns, loadProfiles } from './brief.js';
import { renderProductionMarkdown, renderScriptMarkdown } from './guide.js';
import { buildProductionPackage } from './package.js';
import { retrieveReferenceCandidates } from './retrieve.js';
import { generateScript } from './script.js';

/**
 * Generate planning assets for enabled campaigns.
 * @returns {Promise<{ runId: string, scriptCount: number }>}
 */
export async function runGeneration() {
  await ensureProjectDirectories();

  const campaigns = (await loadCampaigns()).filter((campaign) => campaign.enabled !== false);
  const profiles = await loadProfiles();

  if (campaigns.length === 0) {
    throw new Error('No enabled campaigns found in data/input/campaigns.json.');
  }

  const runId = createTimestampId();
  const runPaths = buildPlanningRunPaths(runId);

  await Promise.all([
    ensureDir(runPaths.runDir),
    ensureDir(runPaths.scriptsDir),
    ensureDir(runPaths.packagesDir),
    ensureDir(runPaths.notionDir)
  ]);

  let generatedScripts = 0;

  for (const campaign of campaigns) {
    const profile = profiles.get(campaign.profileId ?? 'default') ?? profiles.get('default') ?? { id: 'default' };
    const brief = {
      campaignId: campaign.id,
      profileId: profile.id,
      keywords: Array.isArray(campaign.keywords) ? campaign.keywords : [],
      generationMode: campaign.generationMode ?? profile.generationMode ?? env.GENERATION_REFERENCE_MODE,
      transformationIntensity:
        campaign.transformationIntensity ?? profile.allowedTransformationIntensity ?? 'very_light',
      allowedPortabilityLabels:
        Array.isArray(campaign.allowedPortabilityLabels) && campaign.allowedPortabilityLabels.length > 0
          ? campaign.allowedPortabilityLabels
          : ['portable', 'conditional'],
      minimumPortabilityScore:
        Number.isFinite(campaign.minimumPortabilityScore) && campaign.minimumPortabilityScore > 0
          ? campaign.minimumPortabilityScore
          : 40,
      referenceCount: campaign.referenceCount ?? 12,
      generateCount: campaign.generateCount ?? env.GENERATION_DEFAULT_COUNT
    };

    const references = await retrieveReferenceCandidates(brief);

    if (references.length === 0) {
      log.warn('No analyzed references available for generation.', { campaignId: campaign.id });
      continue;
    }

    await writeJson(path.join(runPaths.runDir, `${campaign.id}-brief.json`), {
      profile,
      brief
    });
    await writeJson(path.join(runPaths.runDir, `${campaign.id}-selected_refs.json`), references);

    for (let index = 0; index < brief.generateCount; index += 1) {
      const script = await generateScript(profile, brief, references, index);
      const scriptId = `${campaign.id}-${String(index + 1).padStart(3, '0')}`;
      const jsonPath = path.join(runPaths.scriptsDir, `${scriptId}.json`);
      const markdownPath = path.join(runPaths.scriptsDir, `${scriptId}.md`);
      const scriptRecord = {
        scriptId,
        campaignId: campaign.id,
        profileId: profile.id,
        keywords: brief.keywords,
        generatedAt: new Date().toISOString(),
        ...script
      };
      const productionPackage = await buildProductionPackage(scriptRecord, references);

      await writeJson(jsonPath, scriptRecord);
      await writeText(markdownPath, renderScriptMarkdown(scriptRecord));
      await writeJson(path.join(runPaths.packagesDir, `${scriptId}.production.json`), productionPackage);
      await writeText(path.join(runPaths.packagesDir, `${scriptId}.production.md`), renderProductionMarkdown(productionPackage));

      generatedScripts += 1;
    }
  }

  log.info('Generation run complete.', { runId, generatedScripts });

  return {
    runId,
    scriptCount: generatedScripts
  };
}
