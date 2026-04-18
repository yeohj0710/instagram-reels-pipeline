import { parseMetricValue, scoreMetric, extractHashtags, looksLikeCta, normalizeWhitespace } from '../utils/text.js';

function parseDescriptionMetric(text, label) {
  const normalized = normalizeWhitespace(text);
  const match =
    normalized.match(new RegExp(`([\\d,.]+\\s*(?:[KMB]|만|천|억)?)\\s+${label}`, 'i')) ??
    normalized.match(new RegExp(`${label}[^\\d]{0,10}([\\d,.]+\\s*(?:[KMB]|만|천|억)?)`, 'i'));
  return match ? parseMetricValue(match[1]) : null;
}

/**
 * Build normalized signals for a harvested reference.
 * @param {{ reelId: string, meta: Record<string, unknown>, source: Record<string, unknown>, transcriptText: string }} bundle
 * @returns {Record<string, unknown>}
 */
export function buildReferenceSignals(bundle) {
  const metaDescription = bundle.source?.metaTags?.description ?? bundle.source?.metaTags?.['og:description'] ?? '';
  const likes = parseDescriptionMetric(metaDescription, 'likes?|좋아요');
  const comments = parseDescriptionMetric(metaDescription, 'comments?|댓글');
  const views = parseDescriptionMetric(metaDescription, 'views?|plays?|조회수|재생수');
  const transcript = normalizeWhitespace(bundle.transcriptText);
  const caption = normalizeWhitespace(bundle.meta?.caption ?? '');
  const hashtags = extractHashtags(`${caption} ${transcript}`);
  const durationSeconds = Number(bundle.meta?.durationSeconds ?? bundle.meta?.videoProbe?.format?.duration ?? 0) || null;
  const engagementProxy = Math.round(scoreMetric(likes, 300_000) * 0.5 + scoreMetric(comments, 30_000) * 0.3 + scoreMetric(views, 5_000_000) * 0.2);

  return {
    reelId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    author: bundle.meta?.author ?? null,
    metrics: {
      views,
      likes,
      comments
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
