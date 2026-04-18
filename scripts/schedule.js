import { runSchedule } from '../src/schedule/run.js';
import { getArgValue, getIntArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

runSchedule({
  runId: getArgValue('run'),
  daysAhead: getIntArg('days')
}).catch((error) => {
  log.error('Schedule run failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
