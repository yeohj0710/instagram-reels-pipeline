import { z } from 'zod';

import { runStructuredGeneration } from '../openai/structured.js';
import { createPlan } from '../workspace/plans.js';
import { getReference } from '../workspace/references.js';
import { firstSentence, normalizeWhitespace } from '../utils/text.js';

const sceneSchema = z.object({
  order: z.number(),
  timing: z.string(),
  goal: z.string(),
  script: z.string(),
  visualDirection: z.string(),
  sourceType: z.enum(['information', 'format', 'blend']),
  sourceReferenceId: z.string(),
  sourceField: z.string()
});

const planSchema = z.object({
  title: z.string(),
  summary: z.string(),
  hook: z.string(),
  coreMessage: z.string(),
  whyThisMatch: z.string(),
  scenes: z.array(sceneSchema),
  captionDraft: z.string(),
  reviewChecklist: z.array(z.string())
});

function getInfoTakeaways(reference) {
  const takeaways = Array.isArray(reference?.information?.keyTakeaways) ? reference.information.keyTakeaways : [];

  if (takeaways.length > 0) {
    return takeaways
      .slice(0, 4)
      .map((item, index) => ({
        order: Number.isFinite(Number(item.order)) ? Number(item.order) : index + 1,
        headline: normalizeWhitespace(item.headline) || `Takeaway ${index + 1}`,
        detail: normalizeWhitespace(item.detail) || normalizeWhitespace(item.planningUse) || ''
      }))
      .filter((item) => item.headline || item.detail);
  }

  const beats = Array.isArray(reference?.structure?.body?.beats) ? reference.structure.body.beats : [];

  if (beats.length > 0) {
    return beats.slice(0, 4).map((beat, index) => ({
      order: index + 1,
      headline: normalizeWhitespace(beat.summary) || `Takeaway ${index + 1}`,
      detail: normalizeWhitespace(beat.summary) || ''
    }));
  }

  return [
    {
      order: 1,
      headline: normalizeWhitespace(reference?.information?.summary) || normalizeWhitespace(reference?.analysisSummary) || '핵심 정보',
      detail: normalizeWhitespace(reference?.transcriptPreview) || ''
    }
  ];
}

function getFormatFlow(reference) {
  const sceneFlow = Array.isArray(reference?.format?.sceneFlow) ? reference.format.sceneFlow : [];

  if (sceneFlow.length > 0) {
    return sceneFlow.slice(0, 4).map((scene, index) => ({
      order: index + 1,
      timing: normalizeWhitespace(scene.timing) || '',
      goal: normalizeWhitespace(scene.goal) || `Scene ${index + 1}`,
      direction: normalizeWhitespace(scene.deliveryInstruction) || normalizeWhitespace(scene.visualDirection) || ''
    }));
  }

  const beats = Array.isArray(reference?.structure?.body?.beats) ? reference.structure.body.beats : [];

  if (beats.length > 0) {
    return beats.slice(0, 4).map((beat, index) => ({
      order: index + 1,
      timing: index === 0 ? '0-3s' : '',
      goal: normalizeWhitespace(beat.type) || `Scene ${index + 1}`,
      direction: normalizeWhitespace(beat.summary) || ''
    }));
  }

  return [
    { order: 1, timing: '0-3s', goal: 'Hook', direction: '강한 첫 문장으로 시작' },
    { order: 2, timing: '3-10s', goal: '핵심 정보', direction: '한 문장씩 빠르게 설명' },
    { order: 3, timing: '10-18s', goal: '보강 포인트', direction: '예시나 주의점을 짧게 덧붙임' },
    { order: 4, timing: '18s-end', goal: 'CTA', direction: '저장/공유 유도' }
  ];
}

function buildFallbackPlan(input, infoReferences, formatReferences) {
  const primaryInfo = infoReferences[0];
  const primaryFormat = formatReferences[0];
  const takeaways = getInfoTakeaways(primaryInfo);
  const flow = getFormatFlow(primaryFormat);
  const topic =
    normalizeWhitespace(input?.topic) ||
    normalizeWhitespace(primaryInfo?.topic) ||
    normalizeWhitespace(primaryInfo?.information?.medicalBeautyTopic) ||
    '메디컬뷰티 인사이트';
  const hookSeed =
    normalizeWhitespace(primaryFormat?.format?.hookFormula) ||
    normalizeWhitespace(primaryFormat?.hook) ||
    normalizeWhitespace(primaryFormat?.structure?.hook?.text) ||
    `${topic}에서 바로 써먹을 포인트`;
  const firstTakeaway = takeaways[0];
  const hook = firstSentence(`${hookSeed} ${firstTakeaway?.headline ?? ''}`) ?? hookSeed;
  const coreMessage =
    normalizeWhitespace(primaryInfo?.information?.summary) ||
    normalizeWhitespace(firstTakeaway?.detail) ||
    normalizeWhitespace(primaryInfo?.analysisSummary) ||
    topic;
  const summary = `${topic} 정보를 ${primaryFormat?.title || primaryFormat?.reelId || '형식 레퍼런스'}의 전달 방식으로 풀어낸 기획안`;

  const scenes = flow.map((scene, index) => {
    const takeaway = takeaways[index] ?? takeaways.at(-1) ?? firstTakeaway;
    const isHook = index === 0;
    const isLast = index === flow.length - 1;

    if (isHook) {
      return {
        order: scene.order,
        timing: scene.timing || '0-3s',
        goal: scene.goal || 'Hook',
        script: hook,
        visualDirection: scene.direction || primaryFormat?.format?.openingDevice || '첫 장면에서 바로 핵심 문장',
        sourceType: 'blend',
        sourceReferenceId: primaryFormat.reelId,
        sourceField: 'hookFormula'
      };
    }

    if (isLast) {
      return {
        order: scene.order,
        timing: scene.timing || '18s-end',
        goal: scene.goal || 'CTA',
        script:
          normalizeWhitespace(primaryFormat?.format?.ctaPattern) ||
          '저장해두고, 실제 적용 전에 반드시 전문 검토 포인트를 확인해보세요.',
        visualDirection: scene.direction || '마지막 화면에서 핵심 문구 고정',
        sourceType: 'format',
        sourceReferenceId: primaryFormat.reelId,
        sourceField: 'ctaPattern'
      };
    }

    return {
      order: scene.order,
      timing: scene.timing || '',
      goal: scene.goal || `Scene ${scene.order}`,
      script: [takeaway?.headline, takeaway?.detail].filter(Boolean).join(': '),
      visualDirection:
        scene.direction ||
        normalizeWhitespace(primaryFormat?.format?.deliveryStyle) ||
        '포인트별로 한 컷씩 빠르게 전개',
      sourceType: 'information',
      sourceReferenceId: primaryInfo.reelId,
      sourceField: 'keyTakeaways'
    };
  });

  return {
    title: normalizeWhitespace(input?.title) || `${topic} x ${primaryFormat?.title || primaryFormat?.reelId || 'format'}`,
    topic,
    summary,
    hook,
    coreMessage,
    whyThisMatch: normalizeWhitespace(input?.notes) || '정보 레퍼런스의 핵심 포인트를 형식 레퍼런스의 훅/전개 리듬에 맞춰 재배치했습니다.',
    infoReferenceIds: infoReferences.map((reference) => reference.reelId),
    formatReferenceIds: formatReferences.map((reference) => reference.reelId),
    scenes,
    captionDraft: normalizeWhitespace(primaryInfo?.sourceSnapshot?.caption) || coreMessage,
    reviewChecklist: [
      '의학적 효능, 시술 결과, 부작용 표현을 사람 검수로 다시 확인하기',
      '브랜드명/제품명/병원명 직접 언급이 필요한지 다시 판단하기',
      '형식 레퍼런스의 편집 리듬만 가져오고 과장된 주장 추가하지 않기'
    ],
    sourceBreakdown: {
      information: infoReferences.map((reference) => ({
        reelId: reference.reelId,
        title: reference.title,
        topic: reference.topic,
        summary: reference.information?.summary ?? reference.analysisSummary ?? null
      })),
      format: formatReferences.map((reference) => ({
        reelId: reference.reelId,
        title: reference.title,
        hookFormula: reference.format?.hookFormula ?? reference.hook ?? null,
        deliveryStyle: reference.format?.deliveryStyle ?? null
      }))
    }
  };
}

async function buildAssistedPlan(fallback, infoReferences, formatReferences) {
  const payload = JSON.stringify(
    {
      fallback,
      informationReferences: infoReferences.map((reference) => ({
        reelId: reference.reelId,
        title: reference.title,
        topic: reference.topic,
        summary: reference.information?.summary ?? reference.analysisSummary ?? null,
        keyTakeaways: reference.information?.keyTakeaways ?? [],
        proofPoints: reference.information?.proofPoints ?? [],
        cautionNotes: reference.information?.cautionNotes ?? []
      })),
      formatReferences: formatReferences.map((reference) => ({
        reelId: reference.reelId,
        title: reference.title,
        hookFormula: reference.format?.hookFormula ?? reference.hook ?? null,
        deliveryStyle: reference.format?.deliveryStyle ?? null,
        sceneFlow: reference.format?.sceneFlow ?? [],
        subtitleApproach: reference.format?.subtitleApproach ?? null,
        ctaPattern: reference.format?.ctaPattern ?? null
      }))
    },
    null,
    2
  );

  return runStructuredGeneration({
    schema: planSchema,
    schemaName: 'curated_reference_plan',
    system:
      'You create short-form content plans by combining information references with format references. Stay grounded in the supplied data. Do not invent medical claims, efficacy, numbers, or before/after certainty. If something needs human verification, keep the phrasing cautious and mention it in the checklist.',
    user: payload,
    temperature: 0.2
  });
}

/**
 * Generate and persist a plan from curated information and format references.
 * @param {{ title?: string, topic?: string, notes?: string, infoReferenceIds: string[], formatReferenceIds: string[] }} input
 * @returns {Promise<Record<string, unknown>>}
 */
export async function generateCuratedPlan(input) {
  const infoIds = Array.from(new Set(Array.isArray(input?.infoReferenceIds) ? input.infoReferenceIds : [])).filter(Boolean);
  const formatIds = Array.from(new Set(Array.isArray(input?.formatReferenceIds) ? input.formatReferenceIds : [])).filter(Boolean);

  if (infoIds.length === 0) {
    throw new Error('At least one information reference is required.');
  }

  if (formatIds.length === 0) {
    throw new Error('At least one format reference is required.');
  }

  const infoReferences = await Promise.all(infoIds.map((reelId) => getReference(reelId)));
  const formatReferences = await Promise.all(formatIds.map((reelId) => getReference(reelId)));

  if (infoReferences.some((reference) => !reference)) {
    throw new Error('One or more information references could not be loaded.');
  }

  if (formatReferences.some((reference) => !reference)) {
    throw new Error('One or more format references could not be loaded.');
  }

  const missingInfoAnalysis = infoReferences.find((reference) => !reference.information);
  const missingFormatAnalysis = formatReferences.find((reference) => !reference.format);

  if (missingInfoAnalysis) {
    throw new Error(`Information reference ${missingInfoAnalysis.reelId} has not been analyzed yet.`);
  }

  if (missingFormatAnalysis) {
    throw new Error(`Format reference ${missingFormatAnalysis.reelId} has not been analyzed yet.`);
  }

  const fallback = buildFallbackPlan(input, infoReferences, formatReferences);
  const assisted = await buildAssistedPlan(fallback, infoReferences, formatReferences);

  return createPlan({
    ...fallback,
    ...(assisted ?? {}),
    infoReferenceIds: fallback.infoReferenceIds,
    formatReferenceIds: fallback.formatReferenceIds,
    topic: fallback.topic,
    notes: normalizeWhitespace(input?.notes) || fallback.whyThisMatch
  });
}
