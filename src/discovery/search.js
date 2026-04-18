import { env } from '../config/env.js';
import { sanitizeFileSegment } from '../utils/fs.js';
import { normalizeWhitespace } from '../utils/text.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeInstagramReelUrl(urlString) {
  try {
    const url = new URL(urlString, 'https://www.instagram.com');
    url.hash = '';
    url.search = '';

    const parts = url.pathname.split('/').filter(Boolean);
    const markerIndex = parts.findIndex((part) => ['reel', 'reels', 'p', 'tv'].includes(part));

    if (markerIndex >= 0 && parts[markerIndex + 1]) {
      return `https://www.instagram.com/${parts[markerIndex]}/${parts[markerIndex + 1]}/`;
    }

    return null;
  } catch {
    return null;
  }
}

async function waitForDiscoveryPage(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function collectVisibleReelCards(page, source) {
  return page.evaluate((input) => {
    const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const isVisible = (element) => {
      if (!element) {
        return false;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };

    const selector =
      input.sourceType === 'creator-reels'
        ? 'a[href*="/reel/"], a[href*="/reels/"]'
        : 'a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"], a[href*="/tv/"]';
    const anchors = Array.from(document.querySelectorAll(selector));

    return anchors
      .filter((anchor) => isVisible(anchor))
      .map((anchor) => {
        const href = anchor.getAttribute('href') ?? '';
        const container =
          anchor.closest('article, section, li, div[role="button"], div[role="presentation"], div') ?? anchor;
        const rawText = normalize(container.textContent ?? '');
        const img = container.querySelector('img');
        const ariaLabel = normalize(anchor.getAttribute('aria-label') ?? '');
        const captionSnippet =
          rawText
            .split(/(?<=[.!?])\s+|\n+/)
            .map((part) => part.trim())
            .find((part) => part.length >= 12) ?? null;

        return {
          sourceType: input.sourceType,
          sourceLabel: input.sourceLabel,
          originUrl: window.location.href,
          url: href,
          rawText,
          metricsText:
            rawText.match(
              /(?:[\d,.]+\s*(?:K|M|B|만|천|억)?\s*(?:views?|plays?|likes?|comments?|조회수|재생수|좋아요|댓글)|(?:views?|plays?|likes?|comments?|조회수|재생수|좋아요|댓글)[^\d]{0,10}[\d,.]+\s*(?:K|M|B|만|천|억)?)/gi
            ) ?? [],
          ariaLabel: ariaLabel || null,
          imageAlt: normalize(img?.getAttribute('alt') ?? '') || null,
          captionSnippet,
          discoveredAt: new Date().toISOString()
        };
      })
      .filter((item) => item.url);
  }, source);
}

async function scanSource(page, source, options) {
  const collected = new Map();

  await page.goto(source.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await waitForDiscoveryPage(page);

  for (let index = 0; index < options.maxScrolls; index += 1) {
    const cards = await collectVisibleReelCards(page, source);

    for (const card of cards) {
      const normalizedUrl = normalizeInstagramReelUrl(card.url);

      if (!normalizedUrl) {
        continue;
      }

      collected.set(normalizedUrl, {
        ...card,
        url: normalizedUrl,
        keyword: options.keyword,
        creatorPriority: source.creatorPriority ?? null,
        creatorSeed: source.creatorSeed ?? null
      });
    }

    if (collected.size >= options.maxPerSource) {
      break;
    }

    await page.mouse.wheel(0, 2400);
    await sleep(env.DISCOVERY_KEYWORD_DELAY_MS);
  }

  return Array.from(collected.values()).slice(0, options.maxPerSource);
}

/**
 * Discover candidates from a single source.
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, unknown>} source
 * @param {{ maxScrolls: number, maxCandidatesPerKeyword: number, maxReelsPerCreator: number }} options
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function discoverSourceCandidates(context, source, options) {
  const page = await context.newPage();

  try {
    return await scanSource(page, source, {
      keyword: source.keyword,
      maxScrolls: options.maxScrolls,
      maxPerSource:
        source.maxPerSource ??
        (source.sourceType === 'creator-reels' ? options.maxReelsPerCreator : options.maxCandidatesPerKeyword)
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Build discovery sources for the current run.
 * @param {string[]} keywords
 * @param {Array<{ username: string, niche?: string, priority?: number }>} creators
 * @returns {Array<Record<string, unknown>>}
 */
export function buildDiscoverySources(keywords, creators) {
  const sources = [];

  for (const keyword of keywords) {
    const encodedKeyword = encodeURIComponent(keyword);
    const trimmedKeyword = String(keyword ?? '').trim();
    const slugKeyword = sanitizeFileSegment(trimmedKeyword, '').replace(/-/g, '');

    sources.push({
      id: `keyword-search:${trimmedKeyword}`,
      sourceType: 'keyword-search',
      sourceLabel: trimmedKeyword,
      keyword: trimmedKeyword,
      url: `https://www.instagram.com/explore/search/keyword/?q=${encodedKeyword}`
    });

    if (slugKeyword && /^[a-z0-9_]+$/i.test(trimmedKeyword)) {
      sources.push({
        id: `tag:${slugKeyword}`,
        sourceType: 'tag',
        sourceLabel: slugKeyword,
        keyword: trimmedKeyword,
        url: `https://www.instagram.com/explore/tags/${slugKeyword}/`
      });
    }
  }

  for (const creator of creators) {
    if (!creator.username) {
      continue;
    }

    sources.push({
      id: `creator-reels:${creator.username}`,
      sourceType: 'creator-reels',
      sourceLabel: creator.label ?? creator.username,
      keyword: creator.niche ?? creator.username,
      creatorPriority: creator.priority ?? 1,
      creatorSeed: creator.username,
      maxPerSource: creator.maxReels ?? null,
      url: `https://www.instagram.com/${creator.username}/reels/`
    });
  }

  return sources;
}

/**
 * Discover candidate Reel URLs from keyword and creator sources.
 * @param {import('playwright').BrowserContext} context
 * @param {Record<string, unknown>[]} sources
 * @param {{ maxScrolls: number, maxCandidatesPerKeyword: number, maxReelsPerCreator: number }} options
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function discoverCandidates(context, sources, options) {
  const allCandidates = new Map();

  try {
    for (const source of sources) {
      const discovered = await discoverSourceCandidates(context, source, options);

      for (const candidate of discovered) {
        const existing = allCandidates.get(candidate.url);

        if (!existing) {
          allCandidates.set(candidate.url, candidate);
          continue;
        }

        allCandidates.set(candidate.url, {
          ...existing,
          rawText: normalizeWhitespace(`${existing.rawText ?? ''} ${candidate.rawText ?? ''}`),
          metricsText: [...new Set([...(existing.metricsText ?? []), ...(candidate.metricsText ?? [])])],
          captionSnippet: existing.captionSnippet ?? candidate.captionSnippet,
          sourceType: existing.sourceType,
          sourceLabel: existing.sourceLabel
        });
      }
    }

    const capped = [];
    const keywordCounters = new Map();

    for (const candidate of allCandidates.values()) {
      const keyword = candidate.keyword ?? 'unknown';
      const currentCount = keywordCounters.get(keyword) ?? 0;

      if (currentCount >= options.maxCandidatesPerKeyword) {
        continue;
      }

      keywordCounters.set(keyword, currentCount + 1);
      capped.push(candidate);
    }

    return capped;
  } finally {
    // No-op: discoverSourceCandidates owns its own pages.
  }
}
