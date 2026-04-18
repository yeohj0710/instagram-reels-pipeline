import { z } from 'zod';

import { env } from '../config/env.js';
import { runStructuredGeneration } from '../openai/structured.js';
import { firstSentence, lastSentence, looksLikeCta, normalizeWhitespace } from '../utils/text.js';

const sceneSchema = z.object({
  timing: z.string(),
  goal: z.string(),
  script: z.string(),
  camera: z.string(),
  visualReference: z.string(),
  subtitle: z.string(),
  assets: z.array(z.string()),
  sourceReferenceId: z.string(),
  sourceSection: z.enum(['hook', 'body', 'cta', 'editing'])
});

const generatedScriptSchema = z.object({
  title: z.string(),
  objective: z.string(),
  targetPersona: z.string(),
  sourceReferences: z.array(z.string()),
  assemblyMode: z.enum(['conservative', 'assisted']),
  transformationIntensity: z.string(),
  hook: z.string(),
  bodySummary: z.string(),
  cta: z.string(),
  scenes: z.array(sceneSchema),
  editingGuide: z.array(z.string()),
  assetChecklist: z.array(z.string()),
  captionDraft: z.string(),
  humanEditableFields: z.array(z.string()),
  provenance: z.object({
    hookReferenceId: z.string(),
    bodyReferenceId: z.string(),
    ctaReferenceId: z.string(),
    editingReferenceId: z.string(),
    notes: z.array(z.string())
  })
});

function getTransformationIntensity(profile, brief) {
  return (
    brief?.transformationIntensity ??
    profile?.allowedTransformationIntensity ??
    'very_light'
  );
}

function getGenerationMode(profile, brief) {
  return (
    brief?.generationMode ??
    profile?.generationMode ??
    env.GENERATION_REFERENCE_MODE ??
    'conservative'
  );
}

function pickReference(reference, fallback) {
  return reference ?? fallback ?? null;
}

function deriveCta(reference) {
  const explicit = normalizeWhitespace(reference?.structure?.cta?.text ?? '');

  if (explicit) {
    return explicit;
  }

  const captionTail = lastSentence(reference?.caption ?? '');
  return looksLikeCta(captionTail) ? normalizeWhitespace(captionTail) : '';
}

function buildDeterministicScript(profile, brief, references, variantIndex) {
  const safeReferences = Array.isArray(references) ? references : [];
  const primary = safeReferences[variantIndex % Math.max(1, safeReferences.length)] ?? safeReferences[0] ?? null;
  const secondary = safeReferences[(variantIndex + 1) % Math.max(1, safeReferences.length)] ?? primary;
  const tertiary = safeReferences.find((item) => deriveCta(item)) ?? secondary ?? primary;
  const editingRef = safeReferences.find((item) => Array.isArray(item?.structure?.editing?.brollSlots)) ?? primary;

  const hookRef = pickReference(primary, secondary);
  const bodyRef = pickReference(secondary, hookRef);
  const ctaRef = pickReference(tertiary, bodyRef);
  const transformationIntensity = getTransformationIntensity(profile, brief);

  const hook = normalizeWhitespace(hookRef?.structure?.hook?.text ?? hookRef?.caption ?? brief?.keywords?.[0] ?? 'Reference hook');
  const bodySummary = normalizeWhitespace(bodyRef?.structure?.body?.summary ?? bodyRef?.caption ?? hook);
  const cta = normalizeWhitespace(deriveCta(ctaRef) || deriveCta(hookRef) || 'Human review needed: choose the safest CTA from the source references.');
  const targetPersona = profile?.targetPersonas?.[0]?.name ?? profile?.targetPersonas?.[0] ?? 'General audience';
  const sourceReferences = Array.from(new Set([hookRef?.referenceId, bodyRef?.referenceId, ctaRef?.referenceId].filter(Boolean)));
  const bodyLeadSentence = firstSentence(bodySummary) ?? bodySummary;
  const bodySupportSentence = normalizeWhitespace(bodySummary.replace(bodyLeadSentence, '').trim()) || bodySummary;
  const titleSeed = normalizeWhitespace([brief?.keywords?.[0] ?? '', hookRef?.referenceId ?? '', variantIndex + 1].join(' ')).replace(/\s+/g, '-').toLowerCase();

  return {
    title: titleSeed || `${brief?.profileId ?? 'default'}-${variantIndex + 1}`,
    objective: `Assemble a reference-led Reel plan for ${brief?.keywords?.join(', ') || 'the selected topic'} with minimal rewriting.`,
    targetPersona,
    sourceReferences,
    assemblyMode: 'conservative',
    transformationIntensity,
    hook,
    bodySummary,
    cta,
    scenes: [
      {
        timing: '0-3s',
        goal: 'Hook',
        script: hook,
        camera: 'Match the strongest reference opening shot.',
        visualReference: hookRef?.referenceId ?? 'top-reference',
        subtitle: hook,
        assets: ['reference frame', 'subtitle emphasis timing'],
        sourceReferenceId: hookRef?.referenceId ?? 'unknown',
        sourceSection: 'hook'
      },
      {
        timing: '3-12s',
        goal: 'Main delivery',
        script: bodyLeadSentence,
        camera: 'Match the reference talking-head or demonstration setup.',
        visualReference: bodyRef?.referenceId ?? hookRef?.referenceId ?? 'top-reference',
        subtitle: bodyLeadSentence,
        assets: ['proof shot', 'demo cutaway'],
        sourceReferenceId: bodyRef?.referenceId ?? 'unknown',
        sourceSection: 'body'
      },
      {
        timing: '12-20s',
        goal: 'Support / example',
        script: bodySupportSentence,
        camera: 'Use the same beat order as the selected body reference.',
        visualReference: bodyRef?.referenceId ?? hookRef?.referenceId ?? 'top-reference',
        subtitle: firstSentence(bodySupportSentence) ?? bodySupportSentence,
        assets: ['supporting screenshot', 'B-roll if the reference uses it'],
        sourceReferenceId: bodyRef?.referenceId ?? 'unknown',
        sourceSection: 'body'
      },
      {
        timing: '20s-end',
        goal: 'CTA',
        script: cta,
        camera: 'Finish with the same direct CTA posture as the source reference.',
        visualReference: ctaRef?.referenceId ?? bodyRef?.referenceId ?? 'top-reference',
        subtitle: cta,
        assets: ['CTA end card if the reference uses one'],
        sourceReferenceId: ctaRef?.referenceId ?? 'unknown',
        sourceSection: 'cta'
      }
    ],
    editingGuide: [
      `Keep structure close to reference ${hookRef?.referenceId ?? 'N/A'} for the opening beat.`,
      `Keep body pacing close to reference ${bodyRef?.referenceId ?? 'N/A'}.`,
      `Only add B-roll where reference ${editingRef?.referenceId ?? bodyRef?.referenceId ?? 'N/A'} uses proof, demo, or example shots.`,
      'Do not freestyle new claims; swap only creator-specific examples after human review.'
    ],
    assetChecklist: [
      'Reference screenshots',
      'Reference frame comparison',
      'Proof/demo asset matching the source reference',
      'Human review before publish'
    ],
    captionDraft: normalizeWhitespace(hookRef?.caption ?? bodyRef?.caption ?? hook),
    humanEditableFields: [
      'creator-specific nouns',
      'persona-specific example',
      'CTA intensity',
      'any claim requiring factual verification'
    ],
    provenance: {
      hookReferenceId: hookRef?.referenceId ?? 'unknown',
      bodyReferenceId: bodyRef?.referenceId ?? 'unknown',
      ctaReferenceId: ctaRef?.referenceId ?? 'unknown',
      editingReferenceId: editingRef?.referenceId ?? 'unknown',
      notes: [
        'Default mode is conservative: reuse reference structure with minimal rewriting.',
        `Transformation intensity: ${transformationIntensity}.`,
        'Human should edit only the smallest possible surface area needed for fit.'
      ]
    }
  };
}

function shouldUseAssistedGeneration(profile, brief) {
  const mode = getGenerationMode(profile, brief);
  const intensity = getTransformationIntensity(profile, brief);

  if (mode !== 'assisted') {
    return false;
  }

  return !['none', 'very_light'].includes(String(intensity).toLowerCase());
}

async function buildAssistedScript(profile, brief, references, variantIndex, fallback) {
  const payload = JSON.stringify(
    {
      profile,
      brief,
      variantIndex,
      fallback,
      references: references.map((reference) => ({
        referenceId: reference.referenceId,
        author: reference.author,
        performanceScore: reference.performanceScore,
        hook: reference.structure?.hook?.text ?? null,
        bodySummary: reference.structure?.body?.summary ?? null,
        cta: reference.structure?.cta?.text ?? null,
        contentArchetype: reference.structure?.contentArchetype ?? null,
        visuals: reference.structure?.visuals ?? null,
        editing: reference.structure?.editing ?? null,
        caption: reference.caption ?? null
      }))
    },
    null,
    2
  );

  return runStructuredGeneration({
    schema: generatedScriptSchema,
    schemaName: 'generated_script',
    system:
      'You assemble short-form Reel plans with minimal intervention. Prefer the fallback conservative assembly. Preserve original hook/body/CTA wording where possible. Only make the smallest wording changes needed for creator fit. Every scene must point to a concrete source reference and section. Do not invent unsupported claims or new content angles.',
    user: payload,
    temperature: 0.2
  });
}

/**
 * Generate one reference-grounded script package.
 * Default behavior is conservative and deterministic so the model does not materially steer the content.
 * @param {{ id?: string, targetPersonas?: unknown[] }} profile
 * @param {{ profileId?: string, keywords?: string[], generationMode?: string, transformationIntensity?: string }} brief
 * @param {Record<string, unknown>[]} references
 * @param {number} variantIndex
 * @returns {Promise<Record<string, unknown>>}
 */
export async function generateScript(profile, brief, references, variantIndex) {
  const fallback = buildDeterministicScript(profile, brief, references, variantIndex);

  if (!shouldUseAssistedGeneration(profile, brief)) {
    return {
      ...fallback,
      variantIndex
    };
  }

  const assisted = await buildAssistedScript(profile, brief, references, variantIndex, fallback);

  return {
    ...(assisted ?? fallback),
    variantIndex
  };
}
