import path from 'node:path';

import { env } from '../config/env.js';
import { PUBLISH_NOTION_DIR } from '../storage/paths.js';
import { ensureDir, readJson, writeJson } from '../utils/fs.js';

const NOTION_API_BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

function normalizePropertyName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function truncateText(value, limit = 1800) {
  return String(value ?? '').trim().slice(0, limit);
}

function richText(text) {
  const content = truncateText(text);
  return content ? [{ type: 'text', text: { content } }] : [];
}

function paragraphBlock(text) {
  const content = truncateText(text);

  if (!content) {
    return null;
  }

  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: richText(content)
    }
  };
}

function bulletedBlock(text) {
  const content = truncateText(text);

  if (!content) {
    return null;
  }

  return {
    object: 'block',
    type: 'bulleted_list_item',
    bulleted_list_item: {
      rich_text: richText(content)
    }
  };
}

function headingBlock(text, level = 2) {
  const content = truncateText(text);

  if (!content) {
    return null;
  }

  const type = level === 1 ? 'heading_1' : level === 3 ? 'heading_3' : 'heading_2';

  return {
    object: 'block',
    type,
    [type]: {
      rich_text: richText(content)
    }
  };
}

function markdownToBlocks(markdown) {
  return String(markdown ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 80)
    .map((line) => {
      if (line.startsWith('# ')) {
        return headingBlock(line.slice(2), 1);
      }

      if (line.startsWith('## ')) {
        return headingBlock(line.slice(3), 2);
      }

      if (line.startsWith('### ')) {
        return headingBlock(line.slice(4), 3);
      }

      if (/^- /.test(line)) {
        return bulletedBlock(line.replace(/^- /, ''));
      }

      return paragraphBlock(line);
    })
    .filter(Boolean);
}

async function notionRequest(method, pathname, body) {
  if (!env.NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY is not configured.');
  }

  const response = await fetch(`${NOTION_API_BASE}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Notion API ${method} ${pathname} failed: ${response.status} ${errorText}`);
  }

  return response.json();
}

function findProperty(properties, type, preferredNames = []) {
  const entries = Object.entries(properties ?? {});
  const normalizedTargets = preferredNames.map(normalizePropertyName);

  for (const [name, config] of entries) {
    if (config?.type !== type) {
      continue;
    }

    if (normalizedTargets.includes(normalizePropertyName(name))) {
      return { name, config };
    }
  }

  const fallback = entries.find(([, config]) => config?.type === type);
  return fallback ? { name: fallback[0], config: fallback[1] } : null;
}

function setRichText(properties, property, value) {
  if (!property || value === null || value === undefined || String(value).trim() === '') {
    return;
  }

  properties[property.name] = {
    rich_text: richText(value)
  };
}

function setTitle(properties, property, value) {
  if (!property || !String(value ?? '').trim()) {
    return;
  }

  properties[property.name] = {
    title: richText(value)
  };
}

function setUrl(properties, property, value) {
  if (!property || !String(value ?? '').trim()) {
    return;
  }

  properties[property.name] = {
    url: String(value).trim()
  };
}

function setNumber(properties, property, value) {
  if (!property || !Number.isFinite(value)) {
    return;
  }

  properties[property.name] = {
    number: value
  };
}

function setDate(properties, property, value) {
  if (!property || !String(value ?? '').trim()) {
    return;
  }

  properties[property.name] = {
    date: {
      start: String(value).trim()
    }
  };
}

function setSelect(properties, property, value) {
  if (!property || !String(value ?? '').trim()) {
    return;
  }

  properties[property.name] = {
    select: {
      name: truncateText(value, 100)
    }
  };
}

function setMultiSelect(properties, property, values) {
  const items = Array.isArray(values)
    ? values.map((value) => truncateText(value, 100)).filter(Boolean)
    : [];

  if (!property || items.length === 0) {
    return;
  }

  properties[property.name] = {
    multi_select: items.map((value) => ({ name: value }))
  };
}

function buildScriptProperties(database, script) {
  const properties = database?.properties ?? {};
  const output = {};
  const titleProperty = findProperty(properties, 'title', ['title', 'name']);
  const statusProperty = findProperty(properties, 'select', ['status', 'stage']);
  const campaignProperty = findProperty(properties, 'rich_text', ['campaign', 'campaignid']);
  const profileProperty = findProperty(properties, 'rich_text', ['profile', 'profileid']);
  const scriptIdProperty = findProperty(properties, 'rich_text', ['scriptid', 'id']);
  const objectiveProperty = findProperty(properties, 'rich_text', ['objective']);
  const hookProperty = findProperty(properties, 'rich_text', ['hook']);
  const ctaProperty = findProperty(properties, 'rich_text', ['cta']);
  const urlProperty = findProperty(properties, 'url', ['url', 'sourceurl']);
  const dueDateProperty = findProperty(properties, 'date', ['duedate', 'publishdate', 'date']);
  const keywordProperty = findProperty(properties, 'multi_select', ['keywords', 'tags']);

  setTitle(output, titleProperty, script.title ?? script.scriptId ?? 'Generated Script');
  setSelect(output, statusProperty, script.status ?? 'Ready');
  setRichText(output, campaignProperty, script.campaignId);
  setRichText(output, profileProperty, script.profileId);
  setRichText(output, scriptIdProperty, script.scriptId);
  setRichText(output, objectiveProperty, script.objective);
  setRichText(output, hookProperty, script.hook);
  setRichText(output, ctaProperty, script.cta);
  setUrl(output, urlProperty, script.sourceUrl);
  setDate(output, dueDateProperty, script.dueDate);
  setMultiSelect(output, keywordProperty, script.keywords);

  return output;
}

function buildReferenceProperties(database, reference) {
  const properties = database?.properties ?? {};
  const output = {};
  const titleProperty = findProperty(properties, 'title', ['title', 'name']);
  const referenceIdProperty = findProperty(properties, 'rich_text', ['referenceid', 'shortcode', 'id']);
  const authorProperty = findProperty(properties, 'rich_text', ['author', 'creator', 'handle']);
  const scoreProperty = findProperty(properties, 'number', ['performancescore', 'score']);
  const hookProperty = findProperty(properties, 'rich_text', ['hook']);
  const ctaProperty = findProperty(properties, 'rich_text', ['cta']);
  const typeProperty = findProperty(properties, 'select', ['type', 'archetype', 'contenttype']);
  const urlProperty = findProperty(properties, 'url', ['url', 'sourceurl']);
  const hashtagProperty = findProperty(properties, 'multi_select', ['hashtags', 'tags']);

  setTitle(output, titleProperty, reference.caption ?? reference.referenceId ?? 'Reference');
  setRichText(output, referenceIdProperty, reference.referenceId);
  setRichText(output, authorProperty, reference.author);
  setNumber(output, scoreProperty, Number(reference.performanceScore ?? 0));
  setRichText(output, hookProperty, reference.hook);
  setRichText(output, ctaProperty, reference.cta);
  setSelect(output, typeProperty, reference.contentArchetype);
  setUrl(output, urlProperty, reference.url);
  setMultiSelect(output, hashtagProperty, reference.hashtags);

  return output;
}

async function fetchDatabase(databaseId) {
  return notionRequest('GET', `/databases/${databaseId}`);
}

async function createPage(payload) {
  return notionRequest('POST', '/pages', payload);
}

async function updatePage(pageId, payload) {
  return notionRequest('PATCH', `/pages/${pageId}`, payload);
}

async function loadSyncMap(fileName) {
  await ensureDir(PUBLISH_NOTION_DIR);
  const filePath = path.join(PUBLISH_NOTION_DIR, fileName);
  const map = await readJson(filePath, {});
  return {
    filePath,
    map: map && typeof map === 'object' ? map : {}
  };
}

async function upsertItems({ databaseId, syncFileName, items, mode }) {
  if (!env.NOTION_API_KEY || !databaseId) {
    return {
      attempted: 0,
      created: 0,
      updated: 0,
      skipped: items.length,
      syncFile: path.join(PUBLISH_NOTION_DIR, syncFileName),
      enabled: false
    };
  }

  const database = await fetchDatabase(databaseId);
  const syncState = await loadSyncMap(syncFileName);
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const syncKey = String(item.syncKey ?? '').trim();

    if (!syncKey) {
      skipped += 1;
      continue;
    }

    const properties =
      mode === 'reference' ? buildReferenceProperties(database, item) : buildScriptProperties(database, item);
    const children = markdownToBlocks(item.markdown ?? '');
    const existingPageId = syncState.map[syncKey]?.pageId ?? null;

    if (existingPageId) {
      await updatePage(existingPageId, {
        properties
      });
      syncState.map[syncKey] = {
        pageId: existingPageId,
        syncedAt: new Date().toISOString(),
        mode
      };
      updated += 1;
    } else {
      const createdPage = await createPage({
        parent: { database_id: databaseId },
        properties,
        children: children.length > 0 ? children : undefined
      });

      syncState.map[syncKey] = {
        pageId: createdPage.id,
        syncedAt: new Date().toISOString(),
        mode
      };
      created += 1;
    }
  }

  await writeJson(syncState.filePath, syncState.map);

  return {
    attempted: items.length,
    created,
    updated,
    skipped,
    syncFile: syncState.filePath,
    enabled: true
  };
}

/**
 * Upsert generated scripts into a Notion database.
 * @param {Record<string, unknown>[]} scripts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function upsertNotionPlans(scripts) {
  return upsertItems({
    databaseId: env.NOTION_PLAN_DB_ID,
    syncFileName: 'plan-sync.json',
    items: scripts,
    mode: 'plan'
  });
}

/**
 * Upsert harvested references into a Notion database.
 * @param {Record<string, unknown>[]} references
 * @returns {Promise<Record<string, unknown>>}
 */
export async function upsertNotionReferences(references) {
  return upsertItems({
    databaseId: env.NOTION_REFERENCE_DB_ID,
    syncFileName: 'reference-sync.json',
    items: references,
    mode: 'reference'
  });
}
