import path from 'node:path';

import { env } from '../config/env.js';
import { loadCampaigns } from '../generation/brief.js';
import { getLatestPlanningRunId, loadPlanningScripts } from '../planning/runs.js';
import { ensureProjectDirectories, PUBLISH_SCHEDULES_DIR } from '../storage/paths.js';
import { writeJson } from '../utils/fs.js';
import { log } from '../utils/log.js';
import { upsertNotionPlans } from '../publish/notion.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildDateTime(date, hour = 9, minute = 0) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function toIsoLocal(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(absoluteOffset / 60);
  const offsetRemainderMinutes = absoluteOffset % 60;

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}:00${sign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`;
}

function matchesSchedule(date, schedule) {
  if (!schedule || typeof schedule !== 'object') {
    return false;
  }

  if (schedule.type === 'daily') {
    return true;
  }

  if (schedule.type === 'weekly') {
    const days = Array.isArray(schedule.days) ? schedule.days : [];
    return days.includes(date.getDay());
  }

  if (schedule.type === 'weekday') {
    return date.getDay() >= 1 && date.getDay() <= 5;
  }

  return false;
}

function buildScheduleSlots(schedule, daysAhead) {
  const slots = [];
  const now = new Date();

  for (let offset = 0; offset < daysAhead; offset += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);

    if (!matchesSchedule(date, schedule)) {
      continue;
    }

    slots.push(buildDateTime(date, schedule.hour ?? 9, schedule.minute ?? 0));
  }

  return slots;
}

/**
 * Build a forward-looking publish queue from generated scripts and campaign schedules.
 * @param {{ runId?: string | null, daysAhead?: number | null }} [options]
 * @returns {Promise<{ runId: string, scheduledCount: number, notion: Record<string, unknown> }>}
 */
export async function runSchedule(options = {}) {
  await ensureProjectDirectories();

  const runId = options.runId ?? (await getLatestPlanningRunId());

  if (!runId) {
    throw new Error('No planning run found. Run "npm run generate" first.');
  }

  const campaigns = (await loadCampaigns()).filter((campaign) => campaign.enabled !== false && campaign.schedule);
  const scripts = await loadPlanningScripts(runId);
  const scriptsByCampaign = new Map();

  for (const script of scripts) {
    const bucket = scriptsByCampaign.get(script.campaignId) ?? [];
    bucket.push(script);
    scriptsByCampaign.set(script.campaignId, bucket);
  }

  const daysAhead = Number.isFinite(options.daysAhead) && options.daysAhead > 0 ? options.daysAhead : 14;
  const queue = [];

  for (const campaign of campaigns) {
    const scheduledScripts = (scriptsByCampaign.get(campaign.id) ?? []).sort((left, right) =>
      String(left.scriptId ?? '').localeCompare(String(right.scriptId ?? ''))
    );
    const slots = buildScheduleSlots(campaign.schedule, daysAhead);

    for (let index = 0; index < Math.min(slots.length, scheduledScripts.length); index += 1) {
      const script = scheduledScripts[index];
      const slot = slots[index];

      queue.push({
        runId,
        campaignId: campaign.id,
        scriptId: script.scriptId,
        title: script.title,
        dueDate: toIsoLocal(slot),
        timezone: campaign.schedule.timezone ?? 'Asia/Seoul',
        profileId: script.profileId,
        syncKey: script.scriptId,
        hook: script.hook,
        cta: script.cta,
        objective: script.objective,
        sourceUrl:
          Array.isArray(script.sourceReferences) && script.sourceReferences[0]
            ? `https://www.instagram.com/reels/${script.sourceReferences[0]}/`
            : null,
        markdown: script.markdown ?? '',
        keywords: campaign.keywords ?? [],
        status: 'Scheduled'
      });
    }
  }

  const schedulePayload = {
    runId,
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Seoul',
    daysAhead,
    items: queue
  };

  await writeJson(path.join(PUBLISH_SCHEDULES_DIR, `${runId}.json`), schedulePayload);
  await writeJson(path.join(PUBLISH_SCHEDULES_DIR, 'latest.json'), schedulePayload);

  const notion = env.NOTION_PLAN_DB_ID ? await upsertNotionPlans(queue) : { enabled: false, attempted: 0 };

  log.info('Schedule run complete.', {
    runId,
    scheduledCount: queue.length,
    notionEnabled: notion.enabled
  });

  return {
    runId,
    scheduledCount: queue.length,
    notion
  };
}
