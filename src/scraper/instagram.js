import { parseShortcodeFromUrl } from '../storage/paths.js';
import { normalizeLineEndings, readTextFile } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { normalizeWhitespace, parseMetricValue } from '../utils/text.js';

const COUNT_PATTERN = /\b(?:[\d,.]+|\d+\.\d+[KMB])\s*(?:likes?|views?|comments?)\b/i;
const NOISY_TEXT_PATTERN =
  /^(?:instagram|reels|reel|like|likes|comment|comments|share|share this|follow|following|message|audio|original audio|more|home|search|explore|profile)$/i;
const CAPTION_UI_NOISE_PATTERN =
  /\b(?:likes?|views?|comments?|share|save|follow|following|message|audio|original audio|button|icon|tagged|instagram)\b/i;
const METRIC_VALUE_PATTERN = /([\d,.]+(?:\s*(?:K|M|B|\uCC9C|\uB9CC|\uC5B5))?)/i;
const METRIC_LABEL_PATTERNS = {
  likes: ['\uC88B\uC544\uC694', 'likes?', 'like'],
  views: ['\uC870\uD68C\uC218?', '\uC870\uD68C', '\uC7AC\uC0DD\uC218?', '\uC7AC\uC0DD', 'plays?', 'views?'],
  comments: ['\uB313\uAE00', 'comments?', 'comment'],
  reposts: ['\uB9AC\uD3EC\uC2A4\uD2B8', 'reposts?', 'repost'],
  shares: ['\uACF5\uC720(?:\uD558\uAE30)?', 'shares?', 'share'],
  saves: ['\uC800\uC7A5(?:\uC218)?', 'saves?', 'save']
};
const COMPACT_METRIC_TEXT_PATTERN =
  /(?:(?:좋아요|댓글|리포스트|공유(?:하기)?|저장|조회|재생|likes?|comments?|reposts?|shares?|saves?|views?|plays?)\s*[\d,.]+|[\d,.]+\s*(?:likes?|comments?|reposts?|shares?|saves?|views?|plays?))/i;

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

function parseCandidateUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function decodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function normalizeDownloadUrl(url) {
  const parsed = parseCandidateUrl(url);

  if (!parsed) {
    return url;
  }

  parsed.searchParams.delete('bytestart');
  parsed.searchParams.delete('byteend');

  return parsed.toString();
}

function parseObservedByteRange(url) {
  const parsed = parseCandidateUrl(url);

  if (!parsed) {
    return null;
  }

  const startValue = parsed.searchParams.get('bytestart');
  const endValue = parsed.searchParams.get('byteend');

  if (startValue === null && endValue === null) {
    return null;
  }

  const start = Number.parseInt(startValue ?? '', 10);
  const end = Number.parseInt(endValue ?? '', 10);

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
    return null;
  }

  return { start, end };
}

function hasByteRangeParams(url) {
  const parsed = parseCandidateUrl(url);

  if (!parsed) {
    return false;
  }

  return parsed.searchParams.has('bytestart') || parsed.searchParams.has('byteend');
}

function isLikelyAudioOnlyCandidate(candidate) {
  if (!candidate?.url) {
    return false;
  }

  if (/\/t16\//i.test(candidate.url)) {
    return true;
  }

  try {
    const parsed = new URL(candidate.url);
    const efg = parsed.searchParams.get('efg');
    const decoded = efg ? decodeBase64Url(decodeURIComponent(efg)) : '';

    return /audio|heaac|dash_ln/i.test(decoded);
  } catch {
    return false;
  }
}

function isDirectVideoCandidate(candidate) {
  if (!candidate?.url || isLikelyAudioOnlyCandidate(candidate)) {
    return false;
  }

  if (candidate.url.startsWith('blob:')) {
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

function isDirectAudioCandidate(candidate) {
  if (!candidate?.url || !isLikelyAudioOnlyCandidate(candidate)) {
    return false;
  }

  if (candidate.url.startsWith('blob:')) {
    return false;
  }

  if (/\.m3u8(?:$|\?)/i.test(candidate.url)) {
    return false;
  }

  return (
    /(?:^|\/)video\//i.test(candidate.contentType ?? '') ||
    /(?:^|\/)audio\//i.test(candidate.contentType ?? '') ||
    /\.(?:mp4|m4a|aac|mov)(?:$|\?)/i.test(candidate.url)
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

  let score = priority[candidate.via] ?? 10;

  if (hasByteRangeParams(candidate.url)) {
    score += 20;
  }

  return score;
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

function normalizeCaptionCandidate(text) {
  if (typeof text !== 'string') {
    return '';
  }

  let normalized = normalizeWhitespace(text);

  if (!normalized) {
    return '';
  }

  const quotedMatch = normalized.match(/["'](.+?)["']/);

  if (quotedMatch?.[1]) {
    normalized = normalizeWhitespace(quotedMatch[1]);
  }

  normalized = normalized
    .replace(/^Instagram[^:]*:\s*/i, '')
    .replace(
      /^\d[\d,.]*\s+(?:likes?|views?|comments?)\s*,\s*\d[\d,.]*\s+(?:likes?|views?|comments?)\s*-\s*[^-]+-\s*[^:]+:\s*/i,
      ''
    )
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function scoreCaptionCandidate(text) {
  const normalized = normalizeCaptionCandidate(text);

  if (!normalized || normalized.length < 12 || normalized.length > 500) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (normalized.length >= 20 && normalized.length <= 180) {
    score += 20;
  } else if (normalized.length <= 260) {
    score += 8;
  }

  if (/[.!?]/.test(normalized)) {
    score += 8;
  }

  if (/[\p{L}]/u.test(normalized)) {
    score += 8;
  }

  if (COUNT_PATTERN.test(normalized)) {
    score -= 18;
  }

  if (CAPTION_UI_NOISE_PATTERN.test(normalized)) {
    score -= 22;
  }

  score -= (normalized.match(/@[\w._-]+/g) ?? []).length * 6;
  score -= Math.max(0, (normalized.match(/#[\p{L}\p{N}_-]+/gu) ?? []).length - 6) * 3;
  score -= Math.max(0, (normalized.match(/\d{3,}/g) ?? []).length - 1) * 6;

  return score;
}

function pickCaption(source, videoObject) {
  const ogDescription =
    (typeof source.metaTags?.['og:description'] === 'string' && source.metaTags['og:description'].trim()) ||
    (typeof source.metaTags?.description === 'string' && source.metaTags.description.trim()) ||
    null;

  const candidates = uniqueStrings([
    videoObject?.caption,
    videoObject?.description,
    ogDescription,
    ...((source.captionCandidates ?? []).slice(0, 20))
  ])
    .map((text) => normalizeCaptionCandidate(text))
    .filter((text) => text.length >= 12 && !NOISY_TEXT_PATTERN.test(text));

  const bestCandidate = candidates
    .map((text) => ({
      text,
      score: scoreCaptionCandidate(text)
    }))
    .sort((left, right) => right.score - left.score)[0];

  return bestCandidate && Number.isFinite(bestCandidate.score) ? bestCandidate.text : null;
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

function countMetricLabels(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return 0;
  }

  return Object.values(METRIC_LABEL_PATTERNS).reduce((count, patterns) => {
    const matched = patterns.some((pattern) => new RegExp(pattern, 'i').test(normalized));
    return count + (matched ? 1 : 0);
  }, 0);
}

function isCompactMetricText(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized || normalized.length > 140) {
    return false;
  }

  if (!COMPACT_METRIC_TEXT_PATTERN.test(normalized)) {
    return false;
  }

  const labelCount = countMetricLabels(normalized);
  const digitCount = (normalized.match(/\d/g) ?? []).length;

  return labelCount >= 2 || (labelCount >= 1 && digitCount >= 2 && normalized.length <= 64);
}

function collectMetricTextCandidates(source) {
  const compactCandidates = uniqueStrings([
    ...(Array.isArray(source.countTexts) ? source.countTexts.slice(0, 30) : []),
    ...(Array.isArray(source.captionCandidates) ? source.captionCandidates.slice(0, 40) : []),
    ...(Array.isArray(source.visibleTexts) ? source.visibleTexts.slice(0, 80) : [])
  ]).filter(isCompactMetricText);

  return uniqueStrings([
    ...compactCandidates,
    source.metaTags?.description,
    source.metaTags?.['og:description']
  ]);
}

function extractMetricValueFromText(text, metricKey) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return null;
  }

  if (metricKey === 'comments' && /\bno comments?\b/i.test(normalized)) {
    return 0;
  }

  const labels = METRIC_LABEL_PATTERNS[metricKey] ?? [];

  for (const label of labels) {
    const patterns = [
      new RegExp(`${label}\\s*[:?-]?\\s*${METRIC_VALUE_PATTERN.source}`, 'i'),
      new RegExp(`${METRIC_VALUE_PATTERN.source}\\s*${label}`, 'i')
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      const value = parseMetricValue(match?.[1]);

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

function pickMetricValue(texts, metricKey) {
  for (const text of texts) {
    const value = extractMetricValueFromText(text, metricKey);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function buildDisplayedCounts(source) {
  const texts = collectMetricTextCandidates(source);
  const likes = pickMetricValue(texts, 'likes');
  const views = pickMetricValue(texts, 'views');
  const comments = pickMetricValue(texts, 'comments');
  const reposts = pickMetricValue(texts, 'reposts');
  const shares = pickMetricValue(texts, 'shares') ?? reposts;
  const saves = pickMetricValue(texts, 'saves');

  return {
    likes,
    views,
    comments,
    reposts,
    shares,
    saves,
    raw: texts.slice(0, 20)
  };
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
    if (!candidate?.url) {
      continue;
    }

    const downloadUrl = normalizeDownloadUrl(candidate.url);
    const dedupeKey = candidate.url.startsWith('blob:') ? candidate.url : downloadUrl;
    const observedByteRange = parseObservedByteRange(candidate.url);

    if (deduped.has(dedupeKey)) {
      const existing = deduped.get(dedupeKey);

      if (observedByteRange) {
        existing.observedRangeCount = (existing.observedRangeCount ?? 0) + 1;
        existing.observedByteRange = existing.observedByteRange
          ? {
              start: Math.min(existing.observedByteRange.start, observedByteRange.start),
              end: Math.max(existing.observedByteRange.end, observedByteRange.end)
            }
          : observedByteRange;
      }

      continue;
    }

    deduped.set(dedupeKey, {
      ...candidate,
      downloadUrl,
      hasByteRange: hasByteRangeParams(candidate.url),
      isAudioOnly: isLikelyAudioOnlyCandidate(candidate),
      observedByteRange,
      observedRangeCount: observedByteRange ? 1 : 0
    });
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

      const root = document.querySelector('article') ?? document.querySelector('main') ?? document.body;

      const collectVisibleTexts = () => {
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
        [...root.querySelectorAll('a[href]'), ...document.querySelectorAll('header a[href]')]
          .map((element) => ({
            text: normalize(element.textContent),
            href: element.getAttribute('href') ?? ''
          }))
          .filter((entry) => entry.text && entry.href.startsWith('/'))
          .map((entry) => entry.text)
      ).slice(0, 30);

      const captionCandidates = unique(
        [...root.querySelectorAll('h1, h2, span, div')]
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
        countTexts: visibleTexts
          .filter((text) =>
            /(?:likes?|views?|comments?|plays?|reposts?|shares?|saves?|\uC88B\uC544\uC694|\uB313\uAE00|\uC870\uD68C|\uC7AC\uC0DD|\uB9AC\uD3EC\uC2A4\uD2B8|\uACF5\uC720|\uC800\uC7A5)/i.test(
              text
            )
          )
          .slice(0, 30),
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
  const displayedCounts = buildDisplayedCounts(source);

  return {
    url: source.inputUrl ?? null,
    finalUrl: source.finalUrl ?? null,
    shortcode: source.shortcode ?? null,
    caption: pickCaption(source, videoObject),
    author: pickAuthor(source, videoObject),
    displayedCounts,
    pageTitle: source.pageTitle ?? null,
    pageLanguage: source.pageLanguage ?? null,
    posterUrl: source.videoElement?.poster ?? source.metaTags?.['og:image'] ?? null,
    videoUrl: orderedVideoCandidates[0]?.downloadUrl ?? orderedVideoCandidates[0]?.url ?? null,
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

/**
 * Return direct-download audio candidates ordered by confidence.
 * @param {Record<string, unknown>} source
 * @returns {Array<{ url: string, via: string, contentType: string | null, resourceType: string | null, status: number | null }>}
 */
export function listDownloadableAudioCandidates(source) {
  return (source.mediaCandidates ?? [])
    .filter(isDirectAudioCandidate)
    .sort((left, right) => scoreCandidate(left) - scoreCandidate(right));
}
