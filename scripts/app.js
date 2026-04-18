import { startAppServer } from '../src/app/server.js';
import { env } from '../src/config/env.js';
import { getArgValue, getIntArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

const port = getIntArg('port', env.APP_PORT);
const host = getArgValue('host', env.APP_HOST) ?? env.APP_HOST;

startAppServer({
  port,
  host
})
  .then(({ url }) => {
    log.info('Workspace app is running.', { url });
  })
  .catch((error) => {
    log.error('Workspace app failed to start.', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
