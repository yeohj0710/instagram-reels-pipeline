import path from 'node:path';

import { buildReelPaths, ensureProjectDirectories, REELS_DIR } from '../storage/paths.js';
import { listDirectories, readJson, readTextFile, removeDir, writeJson } from '../utils/fs.js';
import { normalizeWhitespace } from '../utils/text.js';

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

function buildReferenceSummary(bundle, record) {
  const collectionAnalysis = record.collectionType === 'information' ? bundle.information : bundle.format;

  return {
    reelId: record.reelId,
    url: record.url,
    collectionType: record.collectionType,
    title: record.title || collectionAnalysis?.summary || bundle.meta?.caption || record.reelId,
    topic: record.topic,
    tags: record.tags,
    notes: record.notes,
    curation: record.curation,
    manualMetrics: record.manualMetrics,
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
    transcriptPreview: bundle.transcriptText ? bundle.transcriptText.slice(0, 240) : '',
    assetUrls: buildDataUrls(record.reelId)
  };
}

async function loadBundleForReference(reelId) {
  const reelPaths = buildReelPaths(`https://www.instagram.com/reels/${reelId}/`);

  const [record, meta, manifest, structure, portability, information, format, transcriptText] = await Promise.all([
    readJson(reelPaths.recordPath, null),
    readJson(reelPaths.metaPath, {}),
    readJson(reelPaths.manifestPath, {}),
    readJson(reelPaths.structurePath, null),
    readJson(reelPaths.portabilityPath, null),
    readJson(reelPaths.informationPath, null),
    readJson(reelPaths.formatPath, null),
    readTextFile(reelPaths.transcriptTextPath).catch(() => '')
  ]);

  if (!record && Object.keys(meta).length === 0 && Object.keys(manifest).length === 0) {
    return null;
  }

  const normalizedRecord = normalizeReferenceRecord(record ?? {}, {
    reelId,
    url: meta.url ?? manifest.sourceUrl ?? null,
    sourceSnapshot: {
      author: meta.author ?? null,
      caption: meta.caption ?? null,
      durationSeconds: meta.durationSeconds ?? null,
      pageLanguage: meta.pageLanguage ?? null,
      posterUrl: meta.posterUrl ?? null
    }
  });

  return {
    reelId,
    reelPaths,
    record: normalizedRecord,
    meta,
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
