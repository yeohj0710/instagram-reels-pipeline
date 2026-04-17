import { chromium } from 'playwright';

import { AUTH_DIR, AUTH_STATE_PATH } from '../storage/paths.js';
import { ensureDir, fileExists } from '../utils/fs.js';

/**
 * Launch a Chromium browser context, optionally seeded with saved auth state.
 * @param {{ headless: boolean, requireAuth?: boolean }} options
 * @returns {Promise<{ browser: import('playwright').Browser, context: import('playwright').BrowserContext }>}
 */
export async function launchBrowserContext(options) {
  const requireAuth = options.requireAuth ?? true;
  const hasAuthState = await fileExists(AUTH_STATE_PATH);

  if (requireAuth && !hasAuthState) {
    throw new Error(`Missing auth state at ${AUTH_STATE_PATH}. Run "npm run login" first.`);
  }

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    acceptDownloads: true,
    storageState: hasAuthState ? AUTH_STATE_PATH : undefined,
    viewport: { width: 1440, height: 1080 }
  });

  context.setDefaultTimeout(15000);

  return { browser, context };
}

/**
 * Save the current browser auth state back to disk.
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<void>}
 */
export async function saveStorageState(context) {
  await ensureDir(AUTH_DIR);
  await context.storageState({ path: AUTH_STATE_PATH, indexedDB: true });
}

/**
 * Close a Playwright browser context and browser.
 * @param {{ browser: import('playwright').Browser, context: import('playwright').BrowserContext }} session
 * @returns {Promise<void>}
 */
export async function closeBrowserContext(session) {
  await session.context.close().catch(() => {});
  await session.browser.close().catch(() => {});
}
