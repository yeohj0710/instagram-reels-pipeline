import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ensureDir } from '../utils/fs.js';

/**
 * Run a child process and capture stdout/stderr.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

/**
 * Download a video URL that is reachable from the logged-in browser context.
 * Compliance note: do not bypass access controls; only persist media directly exposed in the session.
 * @param {import('playwright').Page} page
 * @param {{ url: string, contentType?: string | null }} candidate
 * @param {string} outputPath
 * @returns {Promise<{ bytes: number, contentType: string | null }>}
 */
export async function downloadMediaFromBrowserContext(page, candidate, outputPath) {
  await ensureDir(path.dirname(outputPath));

  const response = await page.context().request.get(candidate.url, {
    headers: {
      referer: page.url()
    }
  });

  if (!response.ok()) {
    throw new Error(`Download failed with status ${response.status()} for ${candidate.url}`);
  }

  const headers = response.headers();
  const contentType = headers['content-type'] ?? candidate.contentType ?? null;

  if (contentType && /(text\/html|application\/json)/i.test(contentType)) {
    throw new Error(`Expected video content but received ${contentType}`);
  }

  const body = await response.body();

  if (!body.length) {
    throw new Error('Download returned an empty response body.');
  }

  await fs.writeFile(outputPath, body);

  return {
    bytes: body.length,
    contentType
  };
}

/**
 * Run ffprobe against a media file and return parsed JSON output.
 * @param {string} filePath
 * @returns {Promise<Record<string, unknown>>}
 */
export async function probeMedia(filePath) {
  const { stdout } = await runCommand('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ]);

  return JSON.parse(stdout);
}

/**
 * Extract MP3 audio from a video file with FFmpeg.
 * @param {string} videoPath
 * @param {string} audioPath
 * @returns {Promise<string>}
 */
export async function extractAudio(videoPath, audioPath) {
  await ensureDir(path.dirname(audioPath));

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-q:a',
    '2',
    audioPath
  ]);

  return audioPath;
}
