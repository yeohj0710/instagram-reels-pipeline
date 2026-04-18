import { runHarvest } from '../src/discovery/harvest.js';
import { getArgValue, getIntArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

runHarvest({
  runId: getArgValue('run'),
  limit: getIntArg('limit')
}).catch((error) => {
  log.error('Harvest run failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
