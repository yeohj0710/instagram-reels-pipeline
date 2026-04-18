import { analyzePendingReferences, analyzeReferenceIds } from '../src/workspace/analyze.js';
import { getArgValue, getArgValues } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

async function main() {
  const reelIds = getArgValues('reel');

  if (reelIds.length > 0) {
    const references = await analyzeReferenceIds(reelIds);
    log.info('Analyzed selected references.', { total: references.length });
    return;
  }

  const references = await analyzePendingReferences({
    collectionType: getArgValue('collection-type', null)
  });

  log.info('Analyzed pending references.', { total: references.length });
}

main().catch((error) => {
  log.error('Reference analysis failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
