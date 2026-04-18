import { createReference } from '../src/workspace/references.js';
import { processPendingReferences, processReferenceIds } from '../src/workspace/process.js';
import { getArgValue, getArgValues } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

async function main() {
  const reelIds = getArgValues('reel');
  const urls = getArgValues('url');
  const collectionType = getArgValue('collection-type', 'information');

  if (urls.length > 0) {
    const created = [];

    for (const url of urls) {
      const reference = await createReference({
        url,
        collectionType
      });
      created.push(reference.reelId);
    }

    const results = await processReferenceIds(created);
    log.info('Processed references created from URLs.', {
      total: results.length,
      collectionType
    });
    return;
  }

  if (reelIds.length > 0) {
    const results = await processReferenceIds(reelIds);
    log.info('Processed selected references.', { total: results.length });
    return;
  }

  const results = await processPendingReferences({
    collectionType: getArgValue('collection-type', null)
  });
  log.info('Processed pending references.', { total: results.length });
}

main().catch((error) => {
  log.error('Reference processing failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
