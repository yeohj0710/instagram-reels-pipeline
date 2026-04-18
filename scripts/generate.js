import { generateCuratedPlan } from '../src/planning/generate.js';
import { listReferences } from '../src/workspace/references.js';
import { getArgValue, getArgValues } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

async function pickApprovedReferenceIds(collectionType) {
  const references = await listReferences({ collectionType });

  return references
    .filter((reference) => reference.curation.approved && reference.status.focusedAnalysis === 'ready')
    .sort((left, right) => (right.curation.priority ?? 0) - (left.curation.priority ?? 0))
    .map((reference) => reference.reelId);
}

async function main() {
  let infoReferenceIds = getArgValues('info');
  let formatReferenceIds = getArgValues('format');

  if (infoReferenceIds.length === 0) {
    infoReferenceIds = (await pickApprovedReferenceIds('information')).slice(0, 1);
  }

  if (formatReferenceIds.length === 0) {
    formatReferenceIds = (await pickApprovedReferenceIds('format')).slice(0, 1);
  }

  const plan = await generateCuratedPlan({
    title: getArgValue('title', ''),
    topic: getArgValue('topic', ''),
    notes: getArgValue('notes', ''),
    infoReferenceIds,
    formatReferenceIds
  });

  log.info('Generated curated plan.', {
    planId: plan.planId,
    infoReferenceIds,
    formatReferenceIds
  });
}

main().catch((error) => {
  log.error('Plan generation failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
