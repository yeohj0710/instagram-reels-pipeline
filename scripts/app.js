import { spawn } from 'node:child_process';

import { startAppServer } from '../src/app/server.js';
import { env } from '../src/config/env.js';
import { getArgValue, getIntArg, hasArg } from '../src/utils/cli.js';
import { log } from '../src/utils/log.js';

const requestedPort = getIntArg('port', env.APP_PORT);
const host = getArgValue('host', env.APP_HOST) ?? env.APP_HOST;
const shouldOpenBrowser = !hasArg('no-open');
const MAX_PORT_ATTEMPTS = 10;

function openBrowser(url) {
  const options = {
    detached: true,
    stdio: 'ignore'
  };

  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], options).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], options).unref();
    return;
  }

  spawn('xdg-open', [url], options).unref();
}

async function main() {
  let lastError = null;

  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = requestedPort + offset;

    try {
      const { url } = await startAppServer({
        port,
        host
      });

      if (offset > 0) {
        log.warn('Requested app port was busy, started on the next available port instead.', {
          requestedPort,
          activePort: port,
          url
        });
      } else {
        log.info('Workspace app is running.', { url });
      }

      if (shouldOpenBrowser) {
        openBrowser(url);
      }

      return;
    } catch (error) {
      lastError = error;

      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EADDRINUSE')) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error(`Unable to find an open port starting from ${requestedPort}.`);
}

main().catch((error) => {
  log.error('Workspace app failed to start.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
