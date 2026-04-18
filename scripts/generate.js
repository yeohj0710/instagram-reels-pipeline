import { runGeneration } from '../src/generation/run.js';
import { log } from '../src/utils/log.js';

runGeneration().catch((error) => {
  log.error('Generation run failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
