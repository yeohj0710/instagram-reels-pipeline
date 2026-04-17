import { parseShortcodeFromUrl } from '../storage/paths.js';
import { normalizeLineEndings, readTextFile } from '../utils/fs.js';
import { log } from '../utils/log.js';

const COUNT_PATTERN = /\b(?:[\d,.]+|\d+\.\d+[KMB])\s*(?:likes?|views?|comments?)\b/i;
const NOISY_TEXT_PATTERN =
  /^(?:instagram|reels|reel|like|likes|comment|comments|share|share this|follow|following|message|audio|original audio|more|home|search|explore|profile)$/i;

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter(Boolean)
    )
  );
}

function flattenJsonLd(entries) {
  const queue = [...entries];
  const flattened = [];

  while (queue.length > 0) {
    const next = queue.shift();

    if (Array.isArray(next)) {
      queue.push(...next);
      continue;
    }

    if (!next || typeof next !== 'object') {
      continue;
    }

    flattened.push(next);

    if (Array.isArray(next['@graph'])) {
      queue.push(...next['@graph']);
    }
  }

  return flattened;
}

function isDirectVideoCandidate(candidate) {
  if (!candidate?.url || candidate.url.startsWith('blob:')) {
    return false;
  }

  if (/\.m3u8(?:$|\?)/i.test(candidate.url)) {
    return false;
  }

  if (candidate.contentType && /application\/vnd\.apple\.mpegurl/i.test(candidate.contentType)) {
    return false;
  }

  return (
    /(?:^|\/)video\//i.test(candidate.contentType ?? '') ||
    /\.(?:mp4|m4v|mov)(?:$|\?)/i.test(candidate.url)
  );
}

function scoreCandidate(candidate) {
  const priority = {
    'video.currentSrc': 0,
    'video.src': 1,
    'response.media': 2,
    'response.video': 3,
    'meta:og:video': 4
  };

  return priority[candidate.via] ?? 10;
}

function parseJsonLdAuthor(entry) {
  if (!entry) {
    return null;
  }

  const author = entry.author;

  if (typeof author === 'string') {
    return author;
  }

  if (Array.isArray(author)) {
    for (const item of author) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }

      if (item && typeof item === 'object') {
        const name = item.alternateName ?? item.name;

        if (typeof name === 'string' && name.trim()) {
          return name.trim();
        }
      }
    }
  }

  if (author && typeof author === 'object') {
    const name = author.alternateName ?? author.name;

    if (typeof name === 'string' && name.trim()) {
      return name.trim();
    }
  }

  return null;
}

function parseAuthorFromOgTitle(ogTitle) {
  if (typeof ogTitle !== 'string') {
    return null;
  }

  const match = /^(.+?) on Instagram/i.exec(ogTitle.trim());
  return match?.[1]?.trim() || null;
}

function pickCaption(source, videoObject) {
  const fromCandidates = (source.captionCandidates ?? []).find(
    (text) => text.length >= 15 && text.length <= 280 && !NOISY_TEXT_PATTERN.test(text) && !COUNT_PATTERN.test(text)
  );

  const jsonLdCaption =
    (typeof videoObject?.caption === 'string' && videoObject.caption.trim()) ||
    (typeof videoObject?.description === 'string' && videoObject.description.trim()) ||
    null;

  const ogDescription =
    (typeof source.metaTags?.['og:description'] === 'string' && source.metaTags['og:description'].trim()) ||
    (typeof source.metaTags?.description === 'string' && source.metaTags.description.trim()) ||
    null;

  return fromCandidates ?? jsonLdCaption ?? ogDescription ?? null;
}

function pickAuthor(source, videoObject) {
  return (
    source.authorCandidates?.find((text) => /^@?[a-z0-9._]{2,}$/i.test(text)) ??
    parseJsonLdAuthor(videoObject) ??
    parseAuthorFromOgTitle(source.metaTags?.['og:title']) ??
    null
  );
}

function pickCountText(texts, needle) {
  return texts.find((text) => new RegExp(`\\b${needle}s?\\b`, 'i').test(text)) ?? null;
}

function buildMediaCandidates(source, networkCandidates) {
  const combined = [];

  if (source.videoElement?.currentSrc) {
    combined.push({
      url: source.videoElement.currentSrc,
      via: 'video.currentSrc',
      contentType: 'video/mp4',
      resourceType: 'media',
      status: 200
    });
  }

  if (source.videoElement?.src) {
    combined.push({
      url: source.videoElement.src,
      via: 'video.src',
      contentType: 'video/mp4',
      resourceType: 'media',
      status: 200
    });
  }

  if (source.metaTags?.['og:video']) {
    combined.push({
      url: source.metaTags['og:video'],
      via: 'meta:og:video',
      contentType: null,
      resourceType: 'metadata',
      status: 200
    });
  }

  combined.push(...networkCandidates);

  const deduped = new Map();

  for (const candidate of combined) {
    if (!candidate?.url || deduped.has(candidate.url)) {
      continue;
    }

    deduped.set(candidate.url, candidate);
  }

  return Array.from(deduped.values());
}

function attachMediaCollector(page) {
  const candidates = new Map();

  const handler = async (response) => {
    try {
      const url = response.url();
      const headers = await response.allHeaders();
      const contentType = headers['content-type'] ?? null;
      const resourceType = response.request().resourceType();
      const looksLikeVideo =
        resourceType === 'media' ||
        /(?:^|\/)video\//i.test(contentType ?? '') ||
        /\.(?:mp4|m4v|mov|m3u8)(?:$|\?)/i.test(url);

      if (!looksLikeVideo || candidates.has(url)) {
        return;
      }

      candidates.set(url, {
        url,
        via: resourceType === 'media' ? 'response.media' : 'response.video',
        contentType,
        resourceType,
        status: response.status()
      });
    } catch {
      // Ignore response-inspection errors and keep the page moving.
    }
  };

  page.on('response', handler);

  return {
    getCandidates() {
      return Array.from(candidates.values());
    },
    dispose() {
      page.off('response', handler);
    }
  };
}

async function waitForStableInstagramPage(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  await Promise.any([
    page.locator('video').first().waitFor({ state: 'attached', timeout: 7000 }),
    page.locator('article').first().waitFor({ state: 'attached', timeout: 7000 }),
    page.locator('main').first().waitFor({ state: 'attached', timeout: 7000 })
  ]).catch(() => {});

  await page.waitForTimeout(1500);
}

function assertAuthenticatedPage(page) {
  if (/\/accounts\/login/i.test(page.url())) {
    throw new Error('Instagram redirected to login. Refresh auth with "npm run login".');
  }
}

/**
 * Read one Reel URL per line from the configured input file.
 * @param {string} inputPath
 * @returns {Promise<string[]>}
 */
export async function loadInputReelUrls(inputPath) {
  const rawInput = await readTextFile(inputPath).catch((error) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return '';
    }

    throw error;
  });

  const urls = [];
  const seen = new Set();

  for (const line of normalizeLineEndings(rawInput).split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    try {
      const parsed = new URL(trimmed);

      if (!parsed.hostname.toLowerCase().endsWith('instagram.com')) {
        log.warn('Skipping non-Instagram URL in input file.', { url: trimmed });
        continue;
      }

      if (seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      urls.push(trimmed);
    } catch {
      log.warn('Skipping invalid URL in input file.', { line: trimmed });
    }
  }

  return urls;
}

/**
 * Collect raw page information for a Reel from a logged-in browser session.
 * Compliance note: only process URLs the user explicitly provided and is authorized to access.
 * @param {import('playwright').Page} page
 * @param {string} url
 * @returns {Promise<Record<string, unknown>>}
 */
export async function collectReelSource(page, url) {
  const collector = attachMediaCollector(page);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForStableInstagramPage(page);
    assertAuthenticatedPage(page);

    const source = await page.evaluate((inputUrl) => {
      const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const isVisible = (element) => {
        if (!element) {
          return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      };

      const unique = (values) => Array.from(new Set(values.map(normalize).filter(Boolean)));

      const readMeta = (name) => {
        const selector = `meta[property="${name}"], meta[name="${name}"]`;
        const element = document.querySelector(selector);
        return normalize(element?.getAttribute('content') ?? '') || null;
      };

      const safeParseJson = (value) => {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      };

      const collectVisibleTexts = () => {
        const root = document.querySelector('main') ?? document.body;
        const results = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();

        while (node) {
          const text = normalize(node.textContent);
          const parent = node.parentElement;

          if (text && parent && isVisible(parent)) {
            results.push(text);
          }

          if (results.length >= 250) {
            break;
          }

          node = walker.nextNode();
        }

        return unique(results).slice(0, 120);
      };

      const authorCandidates = unique(
        [...document.querySelectorAll('main a[href], article a[href], header a[href]')]
          .map((element) => ({
            text: normalize(element.textContent),
            href: element.getAttribute('href') ?? ''
          }))
          .filter((entry) => entry.text && entry.href.startsWith('/'))
          .map((entry) => entry.text)
      ).slice(0, 30);

      const captionCandidates = unique(
        [...document.querySelectorAll('main h1, article h1, main span, article span, main div, article div')]
          .map((element) => normalize(element.textContent))
          .filter((text) => text.length >= 8 && text.length <= 280)
      ).slice(0, 80);

      const visibleTexts = collectVisibleTexts();
      const video = document.querySelector('video');

      return {
        inputUrl,
        finalUrl: window.location.href,
        pageTitle: document.title || null,
        pageLanguage: document.documentElement.lang || null,
        metaTags: {
          title: readMeta('title'),
          description: readMeta('description'),
          'og:title': readMeta('og:title'),
          'og:description': readMeta('og:description'),
          'og:image': readMeta('og:image'),
          'og:url': readMeta('og:url'),
          'og:video': readMeta('og:video')
        },
        jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map((element) => safeParseJson(element.textContent ?? ''))
          .filter(Boolean)
          .slice(0, 10),
        visibleTexts,
        authorCandidates,
        captionCandidates,
        countTexts: visibleTexts.filter((text) => /\b(?:likes?|views?|comments?)\b/i.test(text)).slice(0, 20),
        videoElement: video
          ? {
              currentSrc: normalize(video.currentSrc || '') || null,
              src: normalize(video.getAttribute('src') || '') || null,
              poster: normalize(video.getAttribute('poster') || '') || null,
              duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(3)) : null,
              width: video.videoWidth || null,
              height: video.videoHeight || null
            }
          : null
      };
    }, url);

    source.shortcode = parseShortcodeFromUrl(source.finalUrl ?? url) ?? parseShortcodeFromUrl(url);
    source.mediaCandidates = buildMediaCandidates(source, collector.getCandidates());
    source.collectedAt = new Date().toISOString();

    return source;
  } finally {
    collector.dispose();
  }
}

/**
 * Normalize raw Reel source data into a smaller metadata document.
 * @param {Record<string, unknown>} source
 * @returns {Record<string, unknown>}
 */
export function normalizeSourceToMeta(source) {
  const flattenedJsonLd = flattenJsonLd(source.jsonLd ?? []);
  const videoObject =
    flattenedJsonLd.find((entry) => {
      const type = entry['@type'];

      if (Array.isArray(type)) {
        return type.includes('VideoObject');
      }

      return type === 'VideoObject';
    }) ?? null;

  const orderedVideoCandidates = listDownloadableVideoCandidates(source);
  const displayedCounts = uniqueStrings(source.countTexts ?? []);

  return {
    url: source.inputUrl ?? null,
    finalUrl: source.finalUrl ?? null,
    shortcode: source.shortcode ?? null,
    caption: pickCaption(source, videoObject),
    author: pickAuthor(source, videoObject),
    displayedCounts: {
      likes: pickCountText(displayedCounts, 'like'),
      views: pickCountText(displayedCounts, 'view'),
      comments: pickCountText(displayedCounts, 'comment'),
      raw: displayedCounts
    },
    pageTitle: source.pageTitle ?? null,
    pageLanguage: source.pageLanguage ?? null,
    posterUrl: source.videoElement?.poster ?? source.metaTags?.['og:image'] ?? null,
    videoUrl: orderedVideoCandidates[0]?.url ?? null,
    durationSeconds: source.videoElement?.duration ?? null
  };
}

/**
 * Return direct-download video candidates ordered by confidence.
 * @param {Record<string, unknown>} source
 * @returns {Array<{ url: string, via: string, contentType: string | null, resourceType: string | null, status: number | null }>}
 */
export function listDownloadableVideoCandidates(source) {
  return (source.mediaCandidates ?? [])
    .filter(isDirectVideoCandidate)
    .sort((left, right) => scoreCandidate(left) - scoreCandidate(right));
}
