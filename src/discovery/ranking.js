import { parseMetricValue, scoreKeywordMatch, scoreMetric } from '../utils/text.js';

function extractMetricTexts(candidate) {
  const raw = Array.isArray(candidate.metricsText) ? candidate.metricsText : [];
  const fromRawText = typeof candidate.rawText === 'string' ? [candidate.rawText] : [];
  return [...raw, ...fromRawText];
}

function extractFirstMatchingMetric(metricTexts, labelPatterns) {
  for (const text of metricTexts) {
    const match =
      text.match(new RegExp(`([\\d,.]+\\s*(?:[KMB]|만|천|억)?)\\s*(?:${labelPatterns})`, 'i')) ??
      text.match(new RegExp(`(?:${labelPatterns})[^\\d]{0,10}([\\d,.]+\\s*(?:[KMB]|만|천|억)?)`, 'i'));

    if (match) {
      const value = parseMetricValue(match[1]);

      if (value !== null) {
        return value;
      }
    }
  }

  return null;
}

/**
 * Score a discovery candidate using visible metadata only.
 * @param {Record<string, unknown>} candidate
 * @returns {Record<string, unknown>}
 */
export function scoreDiscoveryCandidate(candidate) {
  const metricTexts = extractMetricTexts(candidate);
  const views = extractFirstMatchingMetric(metricTexts, 'views?|plays?|조회수|재생수');
  const likes = extractFirstMatchingMetric(metricTexts, 'likes?|좋아요');
  const comments = extractFirstMatchingMetric(metricTexts, 'comments?|댓글');
  const keywordScore = scoreKeywordMatch(candidate.keyword ?? '', [
    candidate.captionSnippet ?? '',
    candidate.rawText ?? '',
    candidate.authorHint ?? ''
  ]);

  const viewsScore = scoreMetric(views, 5_000_000);
  const likesScore = scoreMetric(likes, 500_000);
  const commentsScore = scoreMetric(comments, 50_000);
  const creatorPriorityScore = Number.isFinite(candidate.creatorPriority) ? candidate.creatorPriority * 10 : 0;

  const totalScore = Math.round(
    viewsScore * 0.4 +
      likesScore * 0.2 +
      commentsScore * 0.15 +
      keywordScore * 0.2 +
      creatorPriorityScore * 0.05
  );

  return {
    ...candidate,
    score: totalScore,
    metrics: {
      views,
      likes,
      comments
    },
    scoreBreakdown: {
      viewsScore,
      likesScore,
      commentsScore,
      keywordScore,
      creatorPriorityScore
    }
  };
}

/**
 * Sort candidates by score descending.
 * @param {Record<string, unknown>[]} candidates
 * @returns {Record<string, unknown>[]}
 */
export function rankDiscoveryCandidates(candidates) {
  return [...candidates].sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}
