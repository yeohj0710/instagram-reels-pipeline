import { runPublish } from '../src/publish/run.js';
import { getArgValue, getIntArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

runPublish({
  runId: getArgValue('run'),
  referenceLimit: getIntArg('reference-limit')
}).catch((error) => {
  log.error('Publish run failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
