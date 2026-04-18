import { createTimestampId } from '../utils/fs.js';

const jobs = [];
let draining = false;

function now() {
  return new Date().toISOString();
}

async function drainQueue() {
  if (draining) {
    return;
  }

  draining = true;

  try {
    while (true) {
      const nextJob = jobs.find((job) => job.status === 'queued');

      if (!nextJob) {
        break;
      }

      nextJob.status = 'running';
      nextJob.startedAt = now();

      try {
        nextJob.result = await nextJob.handler();
        nextJob.status = 'completed';
      } catch (error) {
        nextJob.status = 'failed';
        nextJob.error = error instanceof Error ? error.message : String(error);
      } finally {
        nextJob.finishedAt = now();
        delete nextJob.handler;
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Queue a background job and start draining.
 * @param {{ kind: string, label: string, handler: () => Promise<unknown> }} input
 * @returns {Record<string, unknown>}
 */
export function enqueueJob(input) {
  const job = {
    id: createTimestampId(),
    kind: input.kind,
    label: input.label,
    status: 'queued',
    createdAt: now(),
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
    handler: input.handler
  };

  jobs.unshift(job);
  jobs.splice(50);
  void drainQueue();

  return summarizeJob(job);
}

export function summarizeJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    label: job.label,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error,
    result: job.result
  };
}

export function listJobs() {
  return jobs.map((job) => summarizeJob(job));
}
