import path from 'node:path';

import { buildPlanPaths, ensureProjectDirectories, PLANS_DIR } from '../storage/paths.js';
import { createTimestampId, ensureDir, listDirectories, readJson, removeDir, writeJson, writeText } from '../utils/fs.js';
import { normalizeWhitespace } from '../utils/text.js';

function now() {
  return new Date().toISOString();
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

function normalizeScenes(value) {
  return (Array.isArray(value) ? value : [])
    .map((scene, index) => ({
      order: Number.isFinite(Number(scene?.order)) ? Number(scene.order) : index + 1,
      timing: normalizeWhitespace(scene?.timing) || '',
      goal: normalizeWhitespace(scene?.goal) || '',
      script: normalizeWhitespace(scene?.script) || '',
      visualDirection: normalizeWhitespace(scene?.visualDirection) || '',
      sourceType: normalizeWhitespace(scene?.sourceType) || '',
      sourceReferenceId: normalizeWhitespace(scene?.sourceReferenceId) || '',
      sourceField: normalizeWhitespace(scene?.sourceField) || ''
    }))
    .filter((scene) => scene.goal || scene.script || scene.visualDirection);
}

function normalizePlan(plan, fallback = {}) {
  const planId = normalizeWhitespace(plan?.planId) || fallback.planId || createTimestampId();
  const createdAt = normalizeWhitespace(plan?.createdAt) || fallback.createdAt || now();

  return {
    planId,
    title: normalizeWhitespace(plan?.title) || `plan-${planId}`,
    status: normalizeWhitespace(plan?.status) || 'draft',
    topic: normalizeWhitespace(plan?.topic) || '',
    summary: normalizeWhitespace(plan?.summary) || '',
    hook: normalizeWhitespace(plan?.hook) || '',
    coreMessage: normalizeWhitespace(plan?.coreMessage) || '',
    infoReferenceIds: normalizeStringArray(plan?.infoReferenceIds),
    formatReferenceIds: normalizeStringArray(plan?.formatReferenceIds),
    whyThisMatch: normalizeWhitespace(plan?.whyThisMatch) || '',
    scenes: normalizeScenes(plan?.scenes),
    captionDraft: normalizeWhitespace(plan?.captionDraft) || '',
    reviewChecklist: normalizeStringArray(plan?.reviewChecklist),
    notes: normalizeWhitespace(plan?.notes) || '',
    sourceBreakdown: plan?.sourceBreakdown && typeof plan.sourceBreakdown === 'object' ? plan.sourceBreakdown : {},
    createdAt,
    updatedAt: normalizeWhitespace(plan?.updatedAt) || createdAt
  };
}

function mergePlan(existing, patch) {
  return normalizePlan(
    {
      ...existing,
      ...patch,
      infoReferenceIds: patch?.infoReferenceIds !== undefined ? patch.infoReferenceIds : existing.infoReferenceIds,
      formatReferenceIds:
        patch?.formatReferenceIds !== undefined ? patch.formatReferenceIds : existing.formatReferenceIds,
      scenes: patch?.scenes !== undefined ? patch.scenes : existing.scenes,
      reviewChecklist:
        patch?.reviewChecklist !== undefined ? patch.reviewChecklist : existing.reviewChecklist,
      updatedAt: now()
    },
    existing
  );
}

export function renderPlanMarkdown(plan) {
  const scenes = plan.scenes
    .map(
      (scene) =>
        `### ${scene.order}. ${scene.goal}\n- Timing: ${scene.timing || 'TBD'}\n- Script: ${scene.script}\n- Visual: ${
          scene.visualDirection || 'TBD'
        }\n- Source: ${scene.sourceType || 'unknown'} / ${scene.sourceReferenceId || 'unknown'} / ${
          scene.sourceField || 'unknown'
        }`
    )
    .join('\n\n');

  const checklist = plan.reviewChecklist.map((item) => `- ${item}`).join('\n');

  return `# ${plan.title}

## Summary
${plan.summary || 'No summary yet.'}

## Hook
${plan.hook || 'No hook yet.'}

## Core Message
${plan.coreMessage || 'No core message yet.'}

## Match Rationale
${plan.whyThisMatch || 'No rationale yet.'}

## References
- Information: ${plan.infoReferenceIds.join(', ') || 'None'}
- Format: ${plan.formatReferenceIds.join(', ') || 'None'}

## Scenes
${scenes || 'No scenes yet.'}

## Caption Draft
${plan.captionDraft || 'No caption draft yet.'}

## Review Checklist
${checklist || '- None'}

## Notes
${plan.notes || 'No notes yet.'}
`;
}

export async function savePlan(planInput) {
  await ensureProjectDirectories();
  const plan = normalizePlan(planInput);
  const planPaths = buildPlanPaths(plan.planId);

  await ensureDir(planPaths.planDir);
  await Promise.all([writeJson(planPaths.jsonPath, plan), writeText(planPaths.markdownPath, renderPlanMarkdown(plan))]);

  return plan;
}

export async function createPlan(planInput) {
  const planId = normalizeWhitespace(planInput?.planId) || createTimestampId();
  return savePlan({
    ...planInput,
    planId,
    createdAt: now(),
    updatedAt: now()
  });
}

export async function listPlans() {
  await ensureProjectDirectories();
  const planDirs = await listDirectories(PLANS_DIR);
  const plans = await Promise.all(
    planDirs.map(async (planDir) => {
      const planId = path.basename(planDir);
      const planPaths = buildPlanPaths(planId);
      const plan = await readJson(planPaths.jsonPath, null);
      return plan ? normalizePlan(plan, { planId }) : null;
    })
  );

  return plans.filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function getPlan(planId) {
  const planPaths = buildPlanPaths(planId);
  const plan = await readJson(planPaths.jsonPath, null);
  return plan ? normalizePlan(plan, { planId }) : null;
}

export async function updatePlan(planId, patch) {
  const planPaths = buildPlanPaths(planId);
  const existing = await readJson(planPaths.jsonPath, null);

  if (!existing) {
    throw new Error(`Plan ${planId} does not exist.`);
  }

  const plan = mergePlan(normalizePlan(existing, { planId }), patch);
  await savePlan(plan);
  return plan;
}

export async function deletePlan(planId) {
  const planPaths = buildPlanPaths(planId);
  const resolvedPlanDir = path.resolve(planPaths.planDir);
  const resolvedBaseDir = path.resolve(PLANS_DIR);

  if (!resolvedPlanDir.startsWith(`${resolvedBaseDir}${path.sep}`) && resolvedPlanDir !== resolvedBaseDir) {
    throw new Error(`Refusing to delete outside ${resolvedBaseDir}.`);
  }

  await removeDir(resolvedPlanDir);
  return { planId };
}
