import { runDiscovery } from '../src/discovery/run.js';
import { getArgValue, getArgValues, getIntArg, hasArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

runDiscovery({
  runId: getArgValue('run'),
  resume: hasArg('resume'),
  maxSources: getIntArg('max-sources'),
  creatorSeeds: getArgValues('creator'),
  creatorOnly: hasArg('creator-only')
}).catch((error) => {
  log.error('Discovery run failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
