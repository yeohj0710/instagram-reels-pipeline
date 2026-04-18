import { runReferenceAnalysis } from '../src/reference/run.js';
import { getArgValues } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

runReferenceAnalysis({
  reelIds: getArgValues('reel')
}).catch((error) => {
  log.error('Reference analysis failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
