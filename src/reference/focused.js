import { z } from 'zod';

import { runStructuredGeneration } from '../openai/structured.js';
import { writeJson } from '../utils/fs.js';
import { extractHashtags, firstSentence, normalizeWhitespace } from '../utils/text.js';

const informationSchema = z.object({
  summary: z.string(),
  medicalBeautyTopic: z.string(),
  audience: z.string(),
  keyTakeaways: z.array(
    z.object({
      order: z.number(),
      headline: z.string(),
      detail: z.string(),
      planningUse: z.string()
    })
  ),
  proofPoints: z.array(z.string()),
  cautionNotes: z.array(z.string()),
  keywords: z.array(z.string()),
  planningHooks: z.array(z.string())
});

const formatSchema = z.object({
  summary: z.string(),
  hookFormula: z.string(),
  openingDevice: z.string(),
  deliveryStyle: z.string(),
  sceneFlow: z.array(
    z.object({
      order: z.number(),
      timing: z.string(),
      goal: z.string(),
      deliveryInstruction: z.string(),
      visualDirection: z.string()
    })
  ),
  subtitleApproach: z.string(),
  editingRhythm: z.string(),
  ctaPattern: z.string(),
  reusableRules: z.array(z.string()),
  avoidRules: z.array(z.string()),
  keywords: z.array(z.string())
});

function uniqueKeywords(...groups) {
  return Array.from(
    new Set(
      groups
        .flatMap((group) => (Array.isArray(group) ? group : []))
        .map((item) => normalizeWhitespace(item).replace(/^#/, '').toLowerCase())
        .filter(Boolean)
    )
  );
}

function buildInformationFallback(bundle, signals, structure, portability) {
  const beats = Array.isArray(structure?.body?.beats) ? structure.body.beats : [];
  const takeaways = beats.length
    ? beats.slice(0, 4).map((beat, index) => ({
        order: index + 1,
        headline: firstSentence(beat.summary) ?? `Takeaway ${index + 1}`,
        detail: normalizeWhitespace(beat.summary) || structure?.body?.summary || '',
        planningUse: '기획안 본문 포인트로 재사용'
      }))
    : [
        {
          order: 1,
          headline: firstSentence(structure?.body?.summary ?? bundle.meta?.caption ?? bundle.transcriptText ?? '') ?? '핵심 정보',
          detail: normalizeWhitespace(structure?.body?.summary ?? bundle.meta?.caption ?? bundle.transcriptText ?? ''),
          planningUse: '기획안 핵심 메시지로 재사용'
        }
      ];

  const keywords = uniqueKeywords(bundle.record?.tags, signals?.hashtags, extractHashtags(bundle.meta?.caption ?? ''));

  return {
    referenceId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    summary: normalizeWhitespace(structure?.body?.summary ?? bundle.meta?.caption ?? bundle.transcriptText ?? ''),
    medicalBeautyTopic:
      normalizeWhitespace(bundle.record?.topic) || keywords[0] || 'medical beauty',
    audience: '메디컬뷰티 정보를 빠르게 이해하고 싶은 시청자',
    keyTakeaways: takeaways,
    proofPoints: Array.isArray(portability?.reasons?.positives) ? portability.reasons.positives : [],
    cautionNotes: Array.isArray(portability?.reasons?.risks) ? portability.reasons.risks : [],
    keywords,
    planningHooks: [
      normalizeWhitespace(structure?.hook?.text) || `이 주제에서 먼저 봐야 할 포인트`,
      takeaways[0]?.headline ?? '핵심 포인트부터 설명하기'
    ].filter(Boolean)
  };
}

function buildFormatFallback(bundle, signals, structure, portability) {
  const beats = Array.isArray(structure?.body?.beats) ? structure.body.beats : [];
  const sceneFlow = (beats.length > 0 ? beats : [{ summary: structure?.body?.summary ?? '' }]).map((beat, index) => ({
    order: index + 1,
    timing: index === 0 ? '0-3s' : '',
    goal: normalizeWhitespace(beat.type) || `Scene ${index + 1}`,
    deliveryInstruction: normalizeWhitespace(beat.summary) || '한 문장씩 빠르게 전달',
    visualDirection:
      normalizeWhitespace(structure?.visuals?.sceneNotes?.[index]) ||
      normalizeWhitespace(structure?.visuals?.shotPattern?.[index]) ||
      '텍스트와 컷 전환을 함께 사용'
  }));

  return {
    referenceId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    summary: normalizeWhitespace(structure?.body?.summary ?? bundle.meta?.caption ?? bundle.transcriptText ?? ''),
    hookFormula: normalizeWhitespace(structure?.hook?.text) || '첫 문장에서 바로 핵심 포인트 제시',
    openingDevice:
      normalizeWhitespace(structure?.visuals?.sceneNotes?.[0]) ||
      normalizeWhitespace(structure?.visuals?.shotPattern?.[0]) ||
      '오프닝 컷에서 핵심 문구 강조',
    deliveryStyle: normalizeWhitespace(structure?.contentArchetype) || 'educational short-form',
    sceneFlow,
    subtitleApproach: normalizeWhitespace(structure?.editing?.subtitleStyle) || '중앙 자막',
    editingRhythm: [structure?.editing?.pace, structure?.editing?.cutFrequency].filter(Boolean).join(' / ') || 'medium',
    ctaPattern: normalizeWhitespace(structure?.cta?.text) || '저장/공유 유도',
    reusableRules: Array.isArray(portability?.reuse?.reusable) ? portability.reuse.reusable : [],
    avoidRules: Array.isArray(portability?.reuse?.avoid) ? portability.reuse.avoid : [],
    keywords: uniqueKeywords(bundle.record?.tags, signals?.hashtags, extractHashtags(bundle.meta?.caption ?? ''))
  };
}

async function generateInformationAnalysis(bundle, signals, structure, portability) {
  const fallback = buildInformationFallback(bundle, signals, structure, portability);
  const payload = JSON.stringify(
    {
      referenceId: bundle.reelId,
      record: bundle.record,
      meta: bundle.meta,
      transcript: normalizeWhitespace(bundle.transcriptText),
      structure,
      signals,
      portability
    },
    null,
    2
  );

  const generated = await runStructuredGeneration({
    schema: informationSchema,
    schemaName: 'information_reference',
    system:
      'You turn a curated Instagram Reel into structured information-reference data for planning. Focus on the actual informational content, proof cues, caution points, and reusable knowledge. Stay grounded in the supplied transcript/caption. Do not invent medical claims.',
    user: payload,
    temperature: 0.2
  });

  const analysis = {
    ...fallback,
    ...(generated ?? {})
  };

  await writeJson(bundle.reelPaths.informationPath, analysis);
  return analysis;
}

async function generateFormatAnalysis(bundle, signals, structure, portability) {
  const fallback = buildFormatFallback(bundle, signals, structure, portability);
  const payload = JSON.stringify(
    {
      referenceId: bundle.reelId,
      record: bundle.record,
      meta: bundle.meta,
      transcript: normalizeWhitespace(bundle.transcriptText),
      structure,
      signals,
      portability
    },
    null,
    2
  );

  const generated = await runStructuredGeneration({
    schema: formatSchema,
    schemaName: 'format_reference',
    system:
      'You turn a curated Instagram Reel into structured format-reference data for planning. Focus on hook style, delivery rhythm, scene flow, subtitle/editing approach, CTA pattern, and what can be reused. Stay grounded in the supplied reference.',
    user: payload,
    temperature: 0.2
  });

  const analysis = {
    ...fallback,
    ...(generated ?? {})
  };

  await writeJson(bundle.reelPaths.formatPath, analysis);
  return analysis;
}

/**
 * Generate collection-specific structured analysis for a curated reference.
 * @param {{ reelId: string, reelPaths: Record<string, string>, record?: Record<string, unknown>, meta: Record<string, unknown>, transcriptText: string }} bundle
 * @param {Record<string, unknown>} signals
 * @param {Record<string, unknown>} structure
 * @param {Record<string, unknown>} portability
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function analyzeFocusedReference(bundle, signals, structure, portability) {
  const collectionType = normalizeWhitespace(bundle.record?.collectionType).toLowerCase();

  if (collectionType === 'information') {
    return generateInformationAnalysis(bundle, signals, structure, portability);
  }

  if (collectionType === 'format') {
    return generateFormatAnalysis(bundle, signals, structure, portability);
  }

  return null;
}
