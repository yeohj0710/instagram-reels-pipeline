import { runPipeline } from '../src/main.js';
import { log } from '../src/utils/log.js';

runPipeline().catch((error) => {
  log.error('Pipeline failed to start.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
