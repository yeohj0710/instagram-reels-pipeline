import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { closeBrowserContext, launchBrowserContext, saveStorageState } from '../src/scraper/browser.js';
import { ensureProjectDirectories } from '../src/storage/paths.js';
import { log } from '../src/utils/log.js';

async function waitForEnter(prompt) {
  const rl = readline.createInterface({ input, output });

  try {
    await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function main() {
  await ensureProjectDirectories();

  const session = await launchBrowserContext({
    headless: false,
    requireAuth: false
  });

  try {
    const page = await session.context.newPage();

    log.info('Opening Instagram login in a headed browser.');
    log.info('Sign in manually, complete any MFA, then press Enter here to save auth state.');

    await page.goto('https://www.instagram.com/accounts/login/', {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await waitForEnter('Press Enter after Instagram is fully logged in and you can access your authorized Reel URLs...');

    await saveStorageState(session.context);
    log.info('Saved Playwright auth state to data/auth/storageState.json');

    await page.close().catch(() => {});
  } finally {
    await closeBrowserContext(session);
  }
}

main().catch((error) => {
  log.error('Login flow failed.', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
