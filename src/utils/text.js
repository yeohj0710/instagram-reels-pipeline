/**
 * Normalize whitespace in a string.
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse display counts like "3,154", "104K", "1.2M".
 * @param {string | null | undefined} value
 * @returns {number | null}
 */
export function parseMetricValue(value) {
  const normalized = normalizeWhitespace(value).toUpperCase();

  if (!normalized) {
    return null;
  }

  const match = normalized.match(/([\d,.]+)\s*([KMB]|만|천|억)?/i);

  if (!match) {
    return null;
  }

  const base = Number.parseFloat(match[1].replace(/,/g, ''));

  if (!Number.isFinite(base)) {
    return null;
  }

  const multiplier =
    match[2] === 'K' ? 1_000 :
    match[2] === 'M' ? 1_000_000 :
    match[2] === 'B' ? 1_000_000_000 :
    match[2] === '천' ? 1_000 :
    match[2] === '만' ? 10_000 :
    match[2] === '억' ? 100_000_000 :
    1;

  return Math.round(base * multiplier);
}

/**
 * Score a number onto a rough 0-100 scale using logarithmic damping.
 * @param {number | null | undefined} value
 * @param {number} maxReference
 * @returns {number}
 */
export function scoreMetric(value, maxReference = 1_000_000) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  const safeMax = Math.max(10, maxReference);
  const numerator = Math.log10(value + 1);
  const denominator = Math.log10(safeMax + 1);
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

/**
 * Return lowercase hashtag tokens from text.
 * @param {string | null | undefined} value
 * @returns {string[]}
 */
export function extractHashtags(value) {
  return Array.from(
    new Set(
      normalizeWhitespace(value)
        .match(/#[\p{L}\p{N}_-]+/gu)?.map((tag) => tag.toLowerCase()) ?? []
    )
  );
}

/**
 * Rough keyword match score.
 * @param {string} keyword
 * @param {string[]} haystacks
 * @returns {number}
 */
export function scoreKeywordMatch(keyword, haystacks) {
  const normalizedKeyword = normalizeWhitespace(keyword).toLowerCase();

  if (!normalizedKeyword) {
    return 0;
  }

  const normalizedTexts = haystacks.map((item) => normalizeWhitespace(item).toLowerCase()).filter(Boolean);

  if (normalizedTexts.some((text) => text.includes(normalizedKeyword))) {
    return 100;
  }

  const keywordParts = normalizedKeyword.split(/\s+/).filter(Boolean);

  if (keywordParts.length === 0) {
    return 0;
  }

  const hitCount = keywordParts.filter((part) => normalizedTexts.some((text) => text.includes(part))).length;
  return Math.round((hitCount / keywordParts.length) * 70);
}

/**
 * Pick the first non-empty sentence-like chunk.
 * @param {string} text
 * @returns {string | null}
 */
export function firstSentence(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return null;
  }

  const parts = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts[0] ?? normalized;
}

/**
 * Pick the last non-empty sentence-like chunk.
 * @param {string} text
 * @returns {string | null}
 */
export function lastSentence(text) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return null;
  }

  const parts = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts.at(-1) ?? normalized;
}

/**
 * Return whether text looks like a CTA.
 * @param {string | null | undefined} value
 * @returns {boolean}
 */
export function looksLikeCta(value) {
  const normalized = normalizeWhitespace(value).toLowerCase();

  if (!normalized) {
    return false;
  }

  return /(comment|follow|save|share|dm|link|profile|bio|subscribe|reply|message|댓글|팔로우|저장|공유|프로필|링크)/i.test(
    normalized
  );
}
