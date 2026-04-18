import { z } from 'zod';

import { runStructuredGeneration } from '../openai/structured.js';
import { writeJson, writeText } from '../utils/fs.js';
import { firstSentence, lastSentence, looksLikeCta, normalizeWhitespace } from '../utils/text.js';

const structureSchema = z.object({
  contentArchetype: z.string(),
  hook: z.object({
    text: z.string(),
    pattern: z.string(),
    rationale: z.string()
  }),
  body: z.object({
    summary: z.string(),
    beats: z.array(
      z.object({
        order: z.number(),
        type: z.string(),
        summary: z.string()
      })
    )
  }),
  cta: z.object({
    text: z.string().nullable(),
    type: z.string().nullable(),
    rationale: z.string().nullable()
  }),
  visuals: z.object({
    shotPattern: z.array(z.string()),
    sceneNotes: z.array(z.string())
  }),
  editing: z.object({
    pace: z.string(),
    subtitleStyle: z.string(),
    cutFrequency: z.string(),
    brollSlots: z.array(
      z.object({
        atSec: z.number(),
        purpose: z.string()
      })
    )
  })
});

function heuristicStructure(bundle, signals) {
  const transcript = normalizeWhitespace(bundle.transcriptText);
  const caption = normalizeWhitespace(bundle.meta?.caption ?? '');
  const sourceText = transcript || caption;
  const hookText = firstSentence(sourceText) ?? caption ?? '';
  const ctaText = looksLikeCta(lastSentence(sourceText)) ? lastSentence(sourceText) : null;
  const bodyText = sourceText.replace(hookText, '').replace(ctaText ?? '', '').trim();

  return {
    contentArchetype: signals.contentFlags.hasQuestionHook ? 'question-led' : 'educational',
    hook: {
      text: hookText,
      pattern: signals.contentFlags.hasQuestionHook ? 'question' : 'claim',
      rationale: 'Fallback heuristic based on first sentence of transcript/caption.'
    },
    body: {
      summary: bodyText || caption || transcript || '',
      beats: bodyText
        ? bodyText
            .split(/(?<=[.!?])\s+|\n+/)
            .filter(Boolean)
            .slice(0, 4)
            .map((item, index) => ({
              order: index + 1,
              type: index === 0 ? 'setup' : index === 1 ? 'explanation' : 'support',
              summary: item
            }))
        : []
    },
    cta: {
      text: ctaText,
      type: ctaText ? 'engagement' : null,
      rationale: ctaText ? 'Detected CTA-like phrase near the end.' : null
    },
    visuals: {
      shotPattern: ['talking-head', 'text-overlay'],
      sceneNotes: ['Reference-grounded fallback. Review frames for exact visual breakdown.']
    },
    editing: {
      pace: signals.durationSeconds && signals.durationSeconds < 20 ? 'fast' : 'medium',
      subtitleStyle: 'large-centered',
      cutFrequency: signals.durationSeconds && signals.durationSeconds < 20 ? 'high' : 'medium',
      brollSlots: []
    }
  };
}

function buildSummaryMarkdown(bundle, signals, structure) {
  const references = [
    `- Reel ID: ${bundle.reelId}`,
    `- Author: ${bundle.meta?.author ?? 'unknown'}`,
    `- Performance score: ${signals.performanceScore}`,
    `- Content archetype: ${structure.contentArchetype}`
  ].join('\n');

  const beats = structure.body.beats.map((beat) => `- ${beat.order}. ${beat.type}: ${beat.summary}`).join('\n');
  const visuals = structure.visuals.sceneNotes.map((item) => `- ${item}`).join('\n');

  return `# ${bundle.reelId}\n\n## Reference\n${references}\n\n## Hook\n${structure.hook.text}\n\n## Body\n${structure.body.summary}\n\n${beats || '- None'}\n\n## CTA\n${structure.cta.text ?? 'None detected'}\n\n## Visuals\n${visuals || '- None'}\n\n## Editing\n- Pace: ${structure.editing.pace}\n- Subtitle style: ${structure.editing.subtitleStyle}\n- Cut frequency: ${structure.editing.cutFrequency}\n`;
}

/**
 * Analyze one harvested reference into reusable structure.
 * @param {{ reelId: string, reelPaths: Record<string, string>, meta: Record<string, unknown>, transcriptText: string }} bundle
 * @param {Record<string, unknown>} signals
 * @returns {Promise<Record<string, unknown>>}
 */
export async function analyzeReferenceStructure(bundle, signals) {
  const transcript = normalizeWhitespace(bundle.transcriptText);
  const caption = normalizeWhitespace(bundle.meta?.caption ?? '');
  const userPrompt = JSON.stringify(
    {
      referenceId: bundle.reelId,
      author: bundle.meta?.author ?? null,
      caption,
      transcript,
      durationSeconds: bundle.meta?.durationSeconds ?? null,
      performanceScore: signals.performanceScore,
      hashtags: signals.hashtags
    },
    null,
    2
  );

  const generated =
    (await runStructuredGeneration({
      schema: structureSchema,
      schemaName: 'reference_structure',
      system:
        'You extract reusable short-form content structure. Stay strictly reference-grounded. Do not invent new claims. Identify hook, body beats, CTA, visual pattern, and editing rhythm from the provided reference.',
      user: userPrompt,
      temperature: 0.2
    })) ?? heuristicStructure(bundle, signals);

  const structure = {
    referenceId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    ...generated
  };

  await Promise.all([
    writeJson(bundle.reelPaths.structurePath, structure),
    writeJson(bundle.reelPaths.hookPath, structure.hook),
    writeJson(bundle.reelPaths.bodyPath, structure.body),
    writeJson(bundle.reelPaths.ctaPath, structure.cta),
    writeJson(bundle.reelPaths.editingPath, {
      visuals: structure.visuals,
      editing: structure.editing
    }),
    writeText(bundle.reelPaths.summaryPath, buildSummaryMarkdown(bundle, signals, structure))
  ]);

  return structure;
}
