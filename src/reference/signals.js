import { extractHashtags, looksLikeCta, normalizeWhitespace, parseMetricValue, scoreMetric } from '../utils/text.js';

function parseDescriptionMetric(text, label) {
  const normalized = normalizeWhitespace(text);
  const match =
    normalized.match(new RegExp(`([\\d,.]+\\s*(?:[KMB])\\s+${label}`, 'i')) ??
    normalized.match(new RegExp(`${label}[^\\d]{0,10}([\\d,.]+\\s*(?:[KMB])?)`, 'i'));

  return match ? parseMetricValue(match[1]) : null;
}

function parseManualMetric(record, key) {
  const rawValue = record?.manualMetrics?.[key];

  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === 'string') {
    const directNumber = Number.parseFloat(rawValue.replace(/,/g, ''));

    if (Number.isFinite(directNumber)) {
      return Math.round(directNumber);
    }

    return parseMetricValue(rawValue);
  }

  return null;
}

/**
 * Build normalized signals for a harvested reference.
 * Manual metrics entered by a human are preferred over page-derived heuristics.
 * @param {{ reelId: string, meta: Record<string, unknown>, source: Record<string, unknown>, transcriptText: string, record?: Record<string, unknown> }} bundle
 * @returns {Record<string, unknown>}
 */
export function buildReferenceSignals(bundle) {
  const metaDescription = bundle.source?.metaTags?.description ?? bundle.source?.metaTags?.['og:description'] ?? '';
  const manualViews = parseManualMetric(bundle.record, 'views');
  const manualLikes = parseManualMetric(bundle.record, 'likes');
  const manualComments = parseManualMetric(bundle.record, 'comments');
  const manualSaves = parseManualMetric(bundle.record, 'saves');
  const manualShares = parseManualMetric(bundle.record, 'shares');

  const likes = manualLikes ?? parseDescriptionMetric(metaDescription, 'likes?');
  const comments = manualComments ?? parseDescriptionMetric(metaDescription, 'comments?');
  const views = manualViews ?? parseDescriptionMetric(metaDescription, 'views?|plays?');
  const saves = manualSaves;
  const shares = manualShares;

  const transcript = normalizeWhitespace(bundle.transcriptText);
  const caption = normalizeWhitespace(bundle.meta?.caption ?? '');
  const hashtags = extractHashtags(`${caption} ${transcript}`);
  const durationSeconds = Number(bundle.meta?.durationSeconds ?? bundle.meta?.videoProbe?.format?.duration ?? 0) || null;
  const engagementProxy = Math.round(
    scoreMetric(likes, 300_000) * 0.35 +
      scoreMetric(comments, 30_000) * 0.2 +
      scoreMetric(views, 5_000_000) * 0.25 +
      scoreMetric(saves, 60_000) * 0.1 +
      scoreMetric(shares, 40_000) * 0.1
  );

  return {
    reelId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    author: bundle.meta?.author ?? null,
    metrics: {
      views,
      likes,
      comments,
      saves,
      shares
    },
    metricsSource: {
      views: manualViews !== null ? 'manual' : 'page',
      likes: manualLikes !== null ? 'manual' : 'page',
      comments: manualComments !== null ? 'manual' : 'page',
      saves: manualSaves !== null ? 'manual' : 'manual_missing',
      shares: manualShares !== null ? 'manual' : 'manual_missing'
    },
    performanceScore: engagementProxy,
    durationSeconds,
    transcriptLength: transcript.length,
    captionLength: caption.length,
    hashtags,
    language: bundle.meta?.pageLanguage ?? null,
    contentFlags: {
      hasTranscript: Boolean(transcript),
      hasCaption: Boolean(caption),
      hasQuestionHook: /^\S.*\?$/.test((caption.split(/[.!?]/)[0] ?? '').trim()),
      hasCta: looksLikeCta(transcript) || looksLikeCta(caption)
    }
  };
}
