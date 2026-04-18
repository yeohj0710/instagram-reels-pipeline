import { ensureProjectDirectories } from '../storage/paths.js';
import { writeJson } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { rebuildLibraries } from './library.js';
import { evaluateReferencePortability } from './portability.js';
import { listHarvestedReelIds, loadReferenceBundle } from './repository.js';
import { buildReferenceSignals } from './signals.js';
import { analyzeReferenceStructure } from './structure.js';

function hasReferenceMaterial(bundle) {
  return (
    Object.keys(bundle.meta ?? {}).length > 0 ||
    Object.keys(bundle.source ?? {}).length > 0 ||
    Boolean(bundle.transcriptText?.trim())
  );
}

/**
 * Analyze one harvested reel into reusable reference assets.
 * @param {string} reelId
 * @returns {Promise<'analyzed' | 'skipped'>}
 */
export async function analyzeReference(reelId) {
  const bundle = await loadReferenceBundle(reelId);

  if (!hasReferenceMaterial(bundle)) {
    return 'skipped';
  }

  const signals = buildReferenceSignals(bundle);
  await writeJson(bundle.reelPaths.signalsPath, signals);
  const structure = await analyzeReferenceStructure(bundle, signals);
  const portability = evaluateReferencePortability(bundle, signals, structure);
  await writeJson(bundle.reelPaths.portabilityPath, portability);

  return 'analyzed';
}

/**
 * Analyze harvested reels and rebuild aggregate libraries.
 * @param {{ reelIds?: string[] }} [options]
 * @returns {Promise<{ total: number, analyzed: number, skipped: number, errored: number, libraryCount: number }>}
 */
export async function runReferenceAnalysis(options = {}) {
  await ensureProjectDirectories();

  const reelIds = Array.isArray(options.reelIds) && options.reelIds.length > 0 ? options.reelIds : await listHarvestedReelIds();

  if (reelIds.length === 0) {
    throw new Error('No harvested reels found. Run "npm run run" or "npm run harvest" first.');
  }

  let analyzed = 0;
  let skipped = 0;
  let errored = 0;

  for (const reelId of reelIds) {
    try {
      const outcome = await analyzeReference(reelId);

      if (outcome === 'analyzed') {
        analyzed += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errored += 1;
      log.warn('Reference analysis failed for reel.', {
        reelId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const library = await rebuildLibraries();

  log.info('Reference analysis complete.', {
    total: reelIds.length,
    analyzed,
    skipped,
    errored,
    libraryCount: library.referenceCount
  });

  return {
    total: reelIds.length,
    analyzed,
    skipped,
    errored,
    libraryCount: library.referenceCount
  };
}
