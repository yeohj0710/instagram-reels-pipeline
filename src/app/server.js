import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';

import { analyzePendingReferences, analyzeReferenceById } from '../workspace/analyze.js';
import { listJobs, enqueueJob } from './jobs.js';
import { generateCuratedPlan } from '../planning/generate.js';
import { DATA_DIR, ensureProjectDirectories } from '../storage/paths.js';
import { deletePlan, getPlan, listPlans, updatePlan } from '../workspace/plans.js';
import {
  createReference,
  deleteReference,
  getReference,
  listReferences,
  updateReference
} from '../workspace/references.js';
import { processPendingReferences, processReferenceById } from '../workspace/process.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  response.end(text);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

async function serveFile(response, absolutePath) {
  const extension = path.extname(absolutePath).toLowerCase();
  const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
  const buffer = await fs.readFile(absolutePath);

  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store'
  });
  response.end(buffer);
}

async function servePublicAsset(response, pathname) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const absolutePath = path.resolve(PUBLIC_DIR, relativePath);

  if (!absolutePath.startsWith(`${path.resolve(PUBLIC_DIR)}${path.sep}`) && absolutePath !== path.resolve(PUBLIC_DIR, 'index.html')) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    await serveFile(response, absolutePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      sendText(response, 404, 'Not found');
      return;
    }

    throw error;
  }
}

async function serveDataAsset(response, pathname) {
  const relativePath = pathname.replace(/^\/data\//, '');
  const absolutePath = path.resolve(DATA_DIR, relativePath);
  const resolvedDataDir = path.resolve(DATA_DIR);

  if (!absolutePath.startsWith(`${resolvedDataDir}${path.sep}`)) {
    sendText(response, 403, 'Forbidden');
    return;
  }

  try {
    await serveFile(response, absolutePath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      sendText(response, 404, 'Not found');
      return;
    }

    throw error;
  }
}

async function getDashboardPayload() {
  const referenceSummaries = await listReferences();
  const [references, plans] = await Promise.all([
    Promise.all(referenceSummaries.map((reference) => getReference(reference.reelId))),
    listPlans()
  ]);

  return {
    references: references.filter(Boolean),
    plans,
    jobs: listJobs()
  };
}

function queueResponse(response, job) {
  sendJson(response, 202, {
    queued: true,
    job
  });
}

function matchReferenceRoute(pathname) {
  const match = /^\/api\/references\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

function matchReferenceActionRoute(pathname, action) {
  const match = new RegExp(`^/api/references/([^/]+)/${action}$`).exec(pathname);
  return match?.[1] ?? null;
}

function matchPlanRoute(pathname) {
  const match = /^\/api\/plans\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

async function handleApiRequest(request, response, url) {
  const { pathname, searchParams } = url;

  if (request.method === 'GET' && pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/dashboard') {
    sendJson(response, 200, await getDashboardPayload());
    return;
  }

  if (request.method === 'GET' && pathname === '/api/jobs') {
    sendJson(response, 200, { jobs: listJobs() });
    return;
  }

  if (request.method === 'GET' && pathname === '/api/references') {
    sendJson(response, 200, {
      references: await listReferences({
        collectionType: searchParams.get('collectionType') ?? undefined
      })
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/references') {
    const body = await readJsonBody(request);
    sendJson(response, 201, {
      reference: await createReference(body)
    });
    return;
  }

  const referenceId = matchReferenceRoute(pathname);

  if (referenceId && request.method === 'GET') {
    const reference = await getReference(referenceId);

    if (!reference) {
      sendJson(response, 404, { error: `Reference ${referenceId} was not found.` });
      return;
    }

    sendJson(response, 200, { reference });
    return;
  }

  if (referenceId && request.method === 'PATCH') {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      reference: await updateReference(referenceId, body)
    });
    return;
  }

  if (referenceId && request.method === 'DELETE') {
    sendJson(response, 200, await deleteReference(referenceId));
    return;
  }

  const processReferenceId = matchReferenceActionRoute(pathname, 'process');

  if (processReferenceId && request.method === 'POST') {
    const job = enqueueJob({
      kind: 'process-reference',
      label: `Process ${processReferenceId}`,
      handler: () => processReferenceById(processReferenceId)
    });
    queueResponse(response, job);
    return;
  }

  const analyzeReferenceId = matchReferenceActionRoute(pathname, 'analyze');

  if (analyzeReferenceId && request.method === 'POST') {
    const job = enqueueJob({
      kind: 'analyze-reference',
      label: `Analyze ${analyzeReferenceId}`,
      handler: () => analyzeReferenceById(analyzeReferenceId)
    });
    queueResponse(response, job);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/references/process-pending') {
    const body = await readJsonBody(request);
    const job = enqueueJob({
      kind: 'process-pending',
      label: `Process pending ${body.collectionType ?? 'references'}`,
      handler: () => processPendingReferences(body)
    });
    queueResponse(response, job);
    return;
  }

  if (request.method === 'POST' && pathname === '/api/references/analyze-pending') {
    const body = await readJsonBody(request);
    const job = enqueueJob({
      kind: 'analyze-pending',
      label: `Analyze pending ${body.collectionType ?? 'references'}`,
      handler: () => analyzePendingReferences(body)
    });
    queueResponse(response, job);
    return;
  }

  if (request.method === 'GET' && pathname === '/api/plans') {
    sendJson(response, 200, {
      plans: await listPlans()
    });
    return;
  }

  if (request.method === 'POST' && pathname === '/api/plans') {
    const body = await readJsonBody(request);
    const job = enqueueJob({
      kind: 'generate-plan',
      label: body.title ? `Generate ${body.title}` : 'Generate plan',
      handler: () => generateCuratedPlan(body)
    });
    queueResponse(response, job);
    return;
  }

  const planId = matchPlanRoute(pathname);

  if (planId && request.method === 'GET') {
    const plan = await getPlan(planId);

    if (!plan) {
      sendJson(response, 404, { error: `Plan ${planId} was not found.` });
      return;
    }

    sendJson(response, 200, { plan });
    return;
  }

  if (planId && request.method === 'PATCH') {
    const body = await readJsonBody(request);
    sendJson(response, 200, {
      plan: await updatePlan(planId, body)
    });
    return;
  }

  if (planId && request.method === 'DELETE') {
    sendJson(response, 200, await deletePlan(planId));
    return;
  }

  sendJson(response, 404, { error: 'Not found.' });
}

/**
 * Start the local CRUD web app.
 * @param {{ port: number, host?: string }} input
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export async function startAppServer(input) {
  await ensureProjectDirectories();
  const host = input.host ?? '127.0.0.1';
  const port = Number(input.port);

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);

      if (url.pathname.startsWith('/api/')) {
        await handleApiRequest(request, response, url);
        return;
      }

      if (url.pathname.startsWith('/data/')) {
        await serveDataAsset(response, url.pathname);
        return;
      }

      await servePublicAsset(response, url.pathname === '/' ? '/index.html' : url.pathname);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve({
        server,
        url: `http://${host}:${port}`
      });
    });
  });
}
