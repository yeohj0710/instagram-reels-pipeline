import path from 'node:path';

import { normalizeSourceToMeta } from '../scraper/instagram.js';
import { buildReelPaths, ensureProjectDirectories, REELS_DIR } from '../storage/paths.js';
import { listDirectories, readJson, readTextFile, removeDir, writeJson } from '../utils/fs.js';
import { firstSentence, normalizeWhitespace, parseMetricValue } from '../utils/text.js';

export const COLLECTION_TYPES = ['information', 'format', 'unassigned'];

const DEFAULT_MANUAL_METRICS = {
  views: '',
  likes: '',
  comments: '',
  saves: '',
  shares: '',
  retention: '',
  notes: ''
};

const DEFAULT_CURATION = {
  approved: false,
  priority: 0,
  note: ''
};

const DEFAULT_SOURCE_SNAPSHOT = {
  author: null,
  caption: null,
  durationSeconds: null,
  pageLanguage: null,
  posterUrl: null
};

const TITLE_UI_NOISE_PATTERN =
  /\b(?:likes?|views?|comments?|shares?|save|follow|following|audio|original audio|button|icon|tagged|instagram)\b/i;

function now() {
  return new Date().toISOString();
}

function toStringOrEmpty(value) {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
}

function normalizeStringArray(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => normalizeWhitespace(item))
        .filter(Boolean)
    )
  );
}

export function normalizeCollectionType(value, fallback = 'unassigned') {
  const normalized = normalizeWhitespace(value).toLowerCase();
  return COLLECTION_TYPES.includes(normalized) ? normalized : fallback;
}

function normalizeManualMetrics(value) {
  const input = value && typeof value === 'object' ? value : {};

  return {
    views: toStringOrEmpty(input.views).trim(),
    likes: toStringOrEmpty(input.likes).trim(),
    comments: toStringOrEmpty(input.comments).trim(),
    saves: toStringOrEmpty(input.saves).trim(),
    shares: toStringOrEmpty(input.shares).trim(),
    retention: toStringOrEmpty(input.retention).trim(),
    notes: toStringOrEmpty(input.notes).trim()
  };
}

function normalizeCuration(value) {
  const input = value && typeof value === 'object' ? value : {};
  const priority = Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0;

  return {
    approved: Boolean(input.approved),
    priority,
    note: toStringOrEmpty(input.note).trim()
  };
}

function normalizeSourceSnapshot(value) {
  const input = value && typeof value === 'object' ? value : {};

  return {
    author: normalizeWhitespace(input.author) || null,
    caption: normalizeWhitespace(input.caption) || null,
    durationSeconds: Number.isFinite(Number(input.durationSeconds)) ? Number(input.durationSeconds) : null,
    pageLanguage: normalizeWhitespace(input.pageLanguage) || null,
    posterUrl: normalizeWhitespace(input.posterUrl) || null
  };
}

function buildCollectionAnalysisLabel(collectionType, bundle) {
  if (collectionType === 'information') {
    return bundle.information ? 'ready' : 'missing';
  }

  if (collectionType === 'format') {
    return bundle.format ? 'ready' : 'missing';
  }

  return 'unassigned';
}

function buildPipelineStatus(manifest, collectionType, bundle) {
  const processing =
    manifest?.downloaded_video && manifest?.transcribed_audio
      ? 'ready'
      : manifest?.fetched_meta || manifest?.downloaded_video || manifest?.transcribed_audio
        ? 'partial'
        : 'pending';

  return {
    processing,
    fetchedMeta: Boolean(manifest?.fetched_meta),
    videoReady: Boolean(manifest?.downloaded_video),
    transcriptReady: Boolean(manifest?.transcribed_audio),
    framesReady: Boolean(manifest?.extracted_frames),
    focusedAnalysis: buildCollectionAnalysisLabel(collectionType, bundle),
    genericAnalysis: bundle.structure && bundle.portability ? 'ready' : 'missing',
    latestError: Array.isArray(manifest?.errors) && manifest.errors.length > 0 ? manifest.errors.at(-1) : null
  };
}

function normalizeReferenceRecord(record, fallback = {}) {
  const createdAt = normalizeWhitespace(record?.createdAt) || normalizeWhitespace(fallback.createdAt) || now();
  const url = normalizeWhitespace(record?.url) || normalizeWhitespace(fallback.url) || null;
  const reelId = normalizeWhitespace(record?.reelId) || normalizeWhitespace(fallback.reelId) || buildReelPaths(url ?? '').reelId;
  const collectionType = normalizeCollectionType(record?.collectionType ?? fallback.collectionType);

  return {
    reelId,
    url,
    collectionType,
    title: normalizeWhitespace(record?.title) || '',
    topic: normalizeWhitespace(record?.topic) || '',
    tags: normalizeStringArray(record?.tags),
    notes: toStringOrEmpty(record?.notes).trim(),
    manualMetrics: normalizeManualMetrics(record?.manualMetrics ?? DEFAULT_MANUAL_METRICS),
    curation: normalizeCuration(record?.curation ?? DEFAULT_CURATION),
    sourceSnapshot: normalizeSourceSnapshot(record?.sourceSnapshot ?? fallback.sourceSnapshot ?? DEFAULT_SOURCE_SNAPSHOT),
    createdAt,
    updatedAt: normalizeWhitespace(record?.updatedAt) || createdAt,
    lastProcessedAt: normalizeWhitespace(record?.lastProcessedAt) || null,
    lastAnalysisAt: normalizeWhitespace(record?.lastAnalysisAt) || null
  };
}

function mergeReferenceRecord(existing, patch) {
  return normalizeReferenceRecord({
    ...existing,
    ...patch,
    tags: patch?.tags !== undefined ? patch.tags : existing.tags,
    manualMetrics:
      patch?.manualMetrics !== undefined
        ? {
            ...existing.manualMetrics,
            ...(patch.manualMetrics && typeof patch.manualMetrics === 'object' ? patch.manualMetrics : {})
          }
        : existing.manualMetrics,
    curation:
      patch?.curation !== undefined
        ? {
            ...existing.curation,
            ...(patch.curation && typeof patch.curation === 'object' ? patch.curation : {})
          }
        : existing.curation,
    sourceSnapshot:
      patch?.sourceSnapshot !== undefined
        ? {
            ...existing.sourceSnapshot,
            ...(patch.sourceSnapshot && typeof patch.sourceSnapshot === 'object' ? patch.sourceSnapshot : {})
          }
        : existing.sourceSnapshot,
    updatedAt: now()
  });
}

function buildDataUrls(reelId) {
  return {
    video: `/data/reels/${reelId}/media/video.mp4`,
    audio: `/data/reels/${reelId}/media/audio.mp3`,
    transcript: `/data/reels/${reelId}/transcript/transcript.txt`,
    summary: `/data/reels/${reelId}/analysis/summary.md`
  };
}

function formatMetricString(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Intl.NumberFormat('en-US').format(Math.round(value));
  }

  const parsed = parseMetricValue(value);

  if (parsed !== null) {
    return new Intl.NumberFormat('en-US').format(parsed);
  }

  return normalizeWhitespace(value);
}

function deriveAutoMetrics(meta) {
  const displayedCounts = meta?.displayedCounts ?? {};

  return {
    views: formatMetricString(displayedCounts.views),
    likes: formatMetricString(displayedCounts.likes),
    comments: formatMetricString(displayedCounts.comments),
    saves: formatMetricString(displayedCounts.saves),
    shares: formatMetricString(displayedCounts.shares ?? displayedCounts.reposts),
    retention: '',
    notes: ''
  };
}

function mergeManualMetricsWithAuto(record, meta) {
  const autoMetrics = deriveAutoMetrics(meta);
  const manualMetrics = normalizeManualMetrics(record?.manualMetrics);

  return {
    ...manualMetrics,
    views: manualMetrics.views || autoMetrics.views,
    likes: manualMetrics.likes || autoMetrics.likes,
    comments: manualMetrics.comments || autoMetrics.comments,
    saves: manualMetrics.saves || autoMetrics.saves,
    shares: manualMetrics.shares || autoMetrics.shares
  };
}

function pickDisplayedMetricValue(metaValue, normalizedValue) {
  if (typeof metaValue === 'number' && Number.isFinite(metaValue)) {
    return metaValue;
  }

  if (typeof metaValue === 'string') {
    const parsed = parseMetricValue(metaValue);

    if (parsed !== null) {
      return parsed;
    }
  }

  return normalizedValue ?? null;
}

function buildEffectiveMeta(meta, source) {
  const normalizedMeta = source && typeof source === 'object' ? normalizeSourceToMeta(source) : {};
  const metaDisplayedCounts = meta?.displayedCounts ?? {};
  const normalizedDisplayedCounts = normalizedMeta.displayedCounts ?? {};

  return {
    ...normalizedMeta,
    ...meta,
    displayedCounts: {
      ...normalizedDisplayedCounts,
      ...metaDisplayedCounts,
      likes: pickDisplayedMetricValue(metaDisplayedCounts.likes, normalizedDisplayedCounts.likes),
      views: pickDisplayedMetricValue(metaDisplayedCounts.views, normalizedDisplayedCounts.views),
      comments: pickDisplayedMetricValue(metaDisplayedCounts.comments, normalizedDisplayedCounts.comments),
      saves: pickDisplayedMetricValue(metaDisplayedCounts.saves, normalizedDisplayedCounts.saves),
      shares: pickDisplayedMetricValue(metaDisplayedCounts.shares, normalizedDisplayedCounts.shares),
      reposts: pickDisplayedMetricValue(metaDisplayedCounts.reposts, normalizedDisplayedCounts.reposts)
    }
  };
}

function compactText(text, maxLength = 82) {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return '';
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(12, maxLength - 3)).trim()}...`;
}

function normalizeCaptionText(text) {
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

function isUsableDisplayTitle(text) {
  const normalized = normalizeCaptionText(text);

  if (!normalized || normalized.length < 6 || normalized.length > 96) {
    return false;
  }

  const handles = normalized.match(/@[\w._-]+/g) ?? [];
  const hashtags = normalized.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  const longDigitRuns = normalized.match(/\d{3,}/g) ?? [];

  if (handles.length > 1 || hashtags.length > 2 || longDigitRuns.length > 1) {
    return false;
  }

  if (TITLE_UI_NOISE_PATTERN.test(normalized) && normalized.length > 42) {
    return false;
  }

  return /[\p{L}\p{N}]/u.test(normalized);
}

function buildDisplayTitle(bundle, record, collectionAnalysis) {
  const author = normalizeWhitespace(record.sourceSnapshot.author ?? bundle.meta?.author ?? '');

  if (record.title) {
    return {
      title: compactText(normalizeCaptionText(record.title)),
      source: 'manual'
    };
  }

  if (record.collectionType === 'unassigned') {
    if (author) {
      return {
        title: `@${author} - ${record.reelId}`,
        source: 'author_fallback'
      };
    }

    return {
      title: record.reelId,
      source: 'reel_id_fallback'
    };
  }

  const candidates = [
    { source: 'analysis', value: collectionAnalysis?.summary },
    { source: 'hook', value: bundle.structure?.hook?.text },
    { source: 'transcript', value: firstSentence(bundle.transcriptText) },
    { source: 'caption', value: bundle.meta?.caption }
  ];

  for (const candidate of candidates) {
    if (!candidate.value) {
      continue;
    }

    const normalized = normalizeCaptionText(candidate.value);

    if (isUsableDisplayTitle(normalized)) {
      return {
        title: compactText(normalized),
        source: candidate.source
      };
    }
  }

  const topic = normalizeWhitespace(record.topic);

  if (topic && author) {
    return {
      title: compactText(`${topic} - @${author}`),
      source: 'topic_author_fallback'
    };
  }

  if (author) {
    return {
      title: `@${author} - ${record.reelId}`,
      source: 'author_fallback'
    };
  }

  return {
    title: record.reelId,
    source: 'reel_id_fallback'
  };
}

function buildPreviewSnippet(bundle, collectionAnalysis) {
  const candidates = [
    collectionAnalysis?.summary,
    bundle.structure?.body?.summary,
    firstSentence(bundle.transcriptText),
    bundle.meta?.caption
  ];

  for (const candidate of candidates) {
    const normalized = normalizeCaptionText(candidate);

    if (normalized && normalized.length >= 12) {
      return compactText(normalized, 120);
    }
  }

  return '';
}

function buildReferenceSummary(bundle, record) {
  const collectionAnalysis = record.collectionType === 'information' ? bundle.information : bundle.format;
  const displayTitle = buildDisplayTitle(bundle, record, collectionAnalysis);
  const manualMetrics = normalizeManualMetrics(record?.manualMetrics);
  const autoMetrics = deriveAutoMetrics(bundle.meta);
  const displayMetrics = mergeManualMetricsWithAuto(record, bundle.meta);

  return {
    reelId: record.reelId,
    url: record.url,
    collectionType: record.collectionType,
    title: displayTitle.title,
    manualTitle: record.title,
    titleSource: displayTitle.source,
    topic: record.topic,
    tags: record.tags,
    notes: record.notes,
    curation: record.curation,
    manualMetrics,
    autoMetrics,
    displayMetrics,
    sourceSnapshot: {
      ...record.sourceSnapshot,
      author: record.sourceSnapshot.author ?? bundle.meta?.author ?? null,
      caption: record.sourceSnapshot.caption ?? bundle.meta?.caption ?? null,
      durationSeconds: record.sourceSnapshot.durationSeconds ?? bundle.meta?.durationSeconds ?? null,
      pageLanguage: record.sourceSnapshot.pageLanguage ?? bundle.meta?.pageLanguage ?? null,
      posterUrl: record.sourceSnapshot.posterUrl ?? bundle.meta?.posterUrl ?? null
    },
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastProcessedAt: record.lastProcessedAt,
    lastAnalysisAt: record.lastAnalysisAt,
    status: buildPipelineStatus(bundle.manifest, record.collectionType, bundle),
    analysisSummary: collectionAnalysis?.summary ?? null,
    hook:
      bundle.structure?.hook?.text ??
      bundle.format?.hookFormula ??
      bundle.information?.keyTakeaways?.[0]?.headline ??
      null,
    previewSnippet: buildPreviewSnippet(bundle, collectionAnalysis),
    transcriptPreview: bundle.transcriptText ? bundle.transcriptText.slice(0, 240) : '',
    assetUrls: buildDataUrls(record.reelId)
  };
}

async function loadBundleForReference(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);

  const [record, meta, source, manifest, structure, portability, information, format, transcriptText] = await Promise.all([
    readJson(reelPaths.recordPath, null),
    readJson(reelPaths.metaPath, {}),
    readJson(reelPaths.sourcePath, {}),
    readJson(reelPaths.manifestPath, {}),
    readJson(reelPaths.structurePath, null),
    readJson(reelPaths.portabilityPath, null),
    readJson(reelPaths.informationPath, null),
    readJson(reelPaths.formatPath, null),
    readTextFile(reelPaths.transcriptTextPath).catch(() => '')
  ]);

  const effectiveMeta = buildEffectiveMeta(meta, source);

  if (!record && Object.keys(effectiveMeta).length === 0 && Object.keys(manifest).length === 0) {
    return null;
  }

  const normalizedRecord = normalizeReferenceRecord(record ?? {}, {
    reelId,
    url: effectiveMeta.url ?? manifest.sourceUrl ?? null,
    sourceSnapshot: {
      author: effectiveMeta.author ?? null,
      caption: effectiveMeta.caption ?? null,
      durationSeconds: effectiveMeta.durationSeconds ?? null,
      pageLanguage: effectiveMeta.pageLanguage ?? null,
      posterUrl: effectiveMeta.posterUrl ?? null
    }
  });

  return {
    reelId,
    reelPaths,
    record: normalizedRecord,
    meta: effectiveMeta,
    source,
    manifest,
    structure,
    portability,
    information,
    format,
    transcriptText
  };
}

export async function listReferences(options = {}) {
  await ensureProjectDirectories();
  const collectionType = options.collectionType ? normalizeCollectionType(options.collectionType) : null;
  const reelDirs = await listDirectories(REELS_DIR);
  const items = await Promise.all(
    reelDirs.map((reelDir) => loadBundleForReference(path.basename(reelDir)))
  );

  return items
    .filter(Boolean)
    .map((bundle) => buildReferenceSummary(bundle, bundle.record))
    .filter((item) => !collectionType || item.collectionType === collectionType)
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function getReference(reelId) {
  const bundle = await loadBundleForReference(reelId);

  if (!bundle) {
    return null;
  }

  return {
    ...buildReferenceSummary(bundle, bundle.record),
    structure: bundle.structure,
    portability: bundle.portability,
    information: bundle.information,
    format: bundle.format,
    transcriptText: bundle.transcriptText
  };
}

export async function createReference(input) {
  await ensureProjectDirectories();

  const url = normalizeWhitespace(input?.url);

  if (!url) {
    throw new Error('Reference URL is required.');
  }

  const collectionType = normalizeCollectionType(input?.collectionType, '');

  if (!collectionType || collectionType === 'unassigned') {
    throw new Error('collectionType must be either "information" or "format".');
  }

  const reelPaths = buildReelPaths(url);
  const existing = await readJson(reelPaths.recordPath, null);
  const record = mergeReferenceRecord(
    normalizeReferenceRecord(existing ?? {}, { reelId: reelPaths.reelId, url, collectionType }),
    {
      reelId: reelPaths.reelId,
      url,
      collectionType,
      title: input?.title,
      topic: input?.topic,
      tags: input?.tags,
      notes: input?.notes,
      manualMetrics: input?.manualMetrics,
      curation: input?.curation
    }
  );

  await writeJson(reelPaths.recordPath, record);
  return getReference(reelPaths.reelId);
}

export async function updateReference(reelId, patch) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);
  const existing = await readJson(reelPaths.recordPath, null);

  if (!existing) {
    throw new Error(`Reference ${reelId} does not exist.`);
  }

  const record = mergeReferenceRecord(normalizeReferenceRecord(existing), patch);
  await writeJson(reelPaths.recordPath, record);
  return getReference(reelId);
}

export async function touchReferenceProcessed(reelId, meta = {}) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);
  const existing = normalizeReferenceRecord(await readJson(reelPaths.recordPath, null), {
    reelId,
    url: meta.url ?? null
  });

  const record = mergeReferenceRecord(existing, {
    lastProcessedAt: now(),
    sourceSnapshot: {
      author: meta.author ?? null,
      caption: meta.caption ?? null,
      durationSeconds: meta.durationSeconds ?? null,
      pageLanguage: meta.pageLanguage ?? null,
      posterUrl: meta.posterUrl ?? null
    }
  });

  await writeJson(reelPaths.recordPath, record);
  return record;
}

export async function touchReferenceAnalyzed(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);
  const existing = await readJson(reelPaths.recordPath, null);

  if (!existing) {
    return null;
  }

  const record = mergeReferenceRecord(normalizeReferenceRecord(existing), {
    lastAnalysisAt: now()
  });

  await writeJson(reelPaths.recordPath, record);
  return record;
}

export async function deleteReference(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);
  const resolvedReelDir = path.resolve(reelPaths.reelDir);
  const resolvedBaseDir = path.resolve(REELS_DIR);

  if (!resolvedReelDir.startsWith(`${resolvedBaseDir}${path.sep}`) && resolvedReelDir !== resolvedBaseDir) {
    throw new Error(`Refusing to delete outside ${resolvedBaseDir}.`);
  }

  await removeDir(resolvedReelDir);
  return { reelId };
}
