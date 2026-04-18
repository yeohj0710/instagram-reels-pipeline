import path from 'node:path';

import { INPUT_CAMPAIGNS_PATH, PROFILES_DIR } from '../storage/paths.js';
import { listFiles, readJson } from '../utils/fs.js';

/**
 * Load configured campaigns.
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function loadCampaigns() {
  const campaigns = await readJson(INPUT_CAMPAIGNS_PATH, []);
  return Array.isArray(campaigns) ? campaigns : [];
}

/**
 * Load all available profiles indexed by id.
 * @returns {Promise<Map<string, Record<string, unknown>>>}
 */
export async function loadProfiles() {
  const files = await listFiles(PROFILES_DIR);
  const map = new Map();

  for (const filePath of files) {
    if (!filePath.endsWith('.json')) {
      continue;
    }

    const profile = await readJson(filePath, null);

    if (profile && typeof profile === 'object' && typeof profile.id === 'string') {
      map.set(profile.id, profile);
      continue;
    }

    map.set(path.basename(filePath, '.json'), {
      id: path.basename(filePath, '.json'),
      ...(profile ?? {})
    });
  }

  return map;
}
