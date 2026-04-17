import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { env } from '../config/env.js';
import { ensureDir } from '../utils/fs.js';

const RANGE_CHUNK_SIZE = 4 * 1024 * 1024;

function parseIntegerHeader(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseContentRange(headerValue) {
  if (!headerValue) {
    return null;
  }

  const match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(headerValue.trim());

  if (!match) {
    return null;
  }

  return {
    start: Number.parseInt(match[1], 10),
    end: Number.parseInt(match[2], 10),
    total: match[3] === '*' ? null : Number.parseInt(match[3], 10)
  };
}

async function writeBuffer(fileHandle, buffer, position) {
  let offset = 0;

  while (offset < buffer.length) {
    const { bytesWritten } = await fileHandle.write(buffer, offset, buffer.length - offset, position + offset);
    offset += bytesWritten;
  }
}

async function saveResponseBody(outputPath, response) {
  const body = await response.body();

  if (!body.length) {
    throw new Error('Download returned an empty response body.');
  }

  await fs.writeFile(outputPath, body);
  return body.length;
}

async function downloadUsingExplicitRanges(requestContext, requestUrl, referer, outputPath, candidate) {
  const probeResponse = await requestContext.get(requestUrl, {
    headers: {
      referer,
      range: 'bytes=0-0'
    }
  });

  if (!probeResponse.ok()) {
    throw new Error(`Range probe failed with status ${probeResponse.status()} for ${requestUrl}`);
  }

  if (probeResponse.status() === 200) {
    const bytes = await saveResponseBody(outputPath, probeResponse);
    return {
      bytes,
      contentType: probeResponse.headers()['content-type'] ?? candidate.contentType ?? null,
      mode: 'direct'
    };
  }

  const probeRange = parseContentRange(probeResponse.headers()['content-range']);
  const expectedBytes =
    probeRange?.total ??
    (candidate.observedByteRange ? candidate.observedByteRange.end + 1 : null) ??
    parseIntegerHeader(probeResponse.headers()['content-length']);

  if (!expectedBytes || expectedBytes <= 0) {
    throw new Error(`Unable to determine full content length for ranged download: ${requestUrl}`);
  }

  const fileHandle = await fs.open(outputPath, 'w');
  let writtenBytes = 0;

  try {
    for (let start = 0; start < expectedBytes; start += RANGE_CHUNK_SIZE) {
      const end = Math.min(expectedBytes - 1, start + RANGE_CHUNK_SIZE - 1);
      const chunkResponse = await requestContext.get(requestUrl, {
        headers: {
          referer,
          range: `bytes=${start}-${end}`
        }
      });

      if (!chunkResponse.ok()) {
        throw new Error(`Chunk download failed with status ${chunkResponse.status()} for ${requestUrl}`);
      }

      const body = await chunkResponse.body();

      if (!body.length) {
        throw new Error(`Received an empty chunk for range ${start}-${end}`);
      }

      const contentRange = parseContentRange(chunkResponse.headers()['content-range']);

      if (contentRange) {
        if (contentRange.start !== start) {
          throw new Error(
            `Unexpected content-range start ${contentRange.start} for requested range ${start}-${end}`
          );
        }

        await writeBuffer(fileHandle, body, contentRange.start);
        writtenBytes = Math.max(writtenBytes, contentRange.start + body.length);
      } else if (chunkResponse.status() === 200 && start === 0) {
        await writeBuffer(fileHandle, body, 0);
        writtenBytes = body.length;
        break;
      } else {
        throw new Error(`Missing content-range header for ranged chunk ${start}-${end}`);
      }
    }
  } finally {
    await fileHandle.close();
  }

  if (writtenBytes < expectedBytes) {
    throw new Error(`Incomplete ranged download: wrote ${writtenBytes} of ${expectedBytes} bytes`);
  }

  return {
    bytes: writtenBytes,
    contentType: probeResponse.headers()['content-type'] ?? candidate.contentType ?? null,
    mode: 'range'
  };
}

function looksLikeMp4(buffer) {
  if (!buffer || buffer.length < 12) {
    return false;
  }

  return buffer.subarray(4, 8).toString('ascii') === 'ftyp';
}

async function pathExists(targetPath) {
  if (!targetPath) {
    return false;
  }

  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findWinGetExecutable(command) {
  if (process.platform !== 'win32') {
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA;

  if (!localAppData) {
    return null;
  }

  const extension = '.exe';
  const linkedExecutable = path.join(localAppData, 'Microsoft', 'WinGet', 'Links', `${command}${extension}`);

  if (await pathExists(linkedExecutable)) {
    return linkedExecutable;
  }

  const packageRoot = path.join(
    localAppData,
    'Microsoft',
    'WinGet',
    'Packages',
    'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'
  );

  const packageDirs = await fs.readdir(packageRoot, { withFileTypes: true }).catch(() => []);

  for (const entry of packageDirs) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(packageRoot, entry.name, 'bin', `${command}${extension}`);

    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function resolveMediaTool(command) {
  const override = command === 'ffmpeg' ? env.FFMPEG_PATH : env.FFPROBE_PATH;

  if (override && (await pathExists(override))) {
    return override;
  }

  const wingetExecutable = await findWinGetExecutable(command);

  if (wingetExecutable) {
    return wingetExecutable;
  }

  return command;
}

/**
 * Run a child process and capture stdout/stderr.
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export async function runCommand(command, args) {
  const resolvedCommand = await resolveMediaTool(command);

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
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

      reject(new Error(`${resolvedCommand} exited with code ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

/**
 * Download a video URL that is reachable from the logged-in browser context.
 * Compliance note: do not bypass access controls; only persist media directly exposed in the session.
 * @param {import('playwright').Page} page
 * @param {{ url: string, downloadUrl?: string, contentType?: string | null }} candidate
 * @param {string} outputPath
 * @returns {Promise<{ bytes: number, contentType: string | null }>}
 */
export async function downloadMediaFromBrowserContext(page, candidate, outputPath) {
  await ensureDir(path.dirname(outputPath));

  const requestUrl = candidate.downloadUrl ?? candidate.url;
  const requestContext = page.context().request;

  if (candidate.hasByteRange || (candidate.observedRangeCount ?? 0) > 0) {
    return downloadUsingExplicitRanges(requestContext, requestUrl, page.url(), outputPath, candidate);
  }

  const response = await requestContext.get(requestUrl, {
    headers: {
      referer: page.url()
    }
  });

  if (!response.ok()) {
    throw new Error(`Download failed with status ${response.status()} for ${requestUrl}`);
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

  const responseRange = parseContentRange(response.headers()['content-range']);
  const contentLength = parseIntegerHeader(response.headers()['content-length']);
  const expectedTotalBytes = responseRange?.total ?? null;
  const isPartial =
    response.status() === 206 ||
    (expectedTotalBytes !== null && body.length < expectedTotalBytes) ||
    (!!candidate.hasByteRange && !looksLikeMp4(body));

  if (isPartial) {
    return downloadUsingExplicitRanges(requestContext, requestUrl, page.url(), outputPath, candidate);
  }

  await fs.writeFile(outputPath, body);

  return {
    bytes: body.length,
    contentType,
    mode: contentLength && body.length === contentLength ? 'direct' : 'direct'
  };
}

/**
 * Perform a lightweight MP4 sanity check so partial fragments are not treated as full downloads.
 * @param {string} filePath
 * @returns {Promise<{ isLikelyValid: boolean, size: number, atoms: string[] }>}
 */
export async function inspectMp4File(filePath) {
  const buffer = await fs.readFile(filePath);
  const size = buffer.length;
  const scanLength = Math.min(size, 1024 * 1024);
  const text = buffer.subarray(0, scanLength).toString('latin1');
  const atoms = ['ftyp', 'moov', 'moof', 'mdat'].filter((atom) => text.includes(atom));
  const isLikelyValid = size >= 4096 && atoms.includes('ftyp') && atoms.includes('mdat');

  return {
    isLikelyValid,
    size,
    atoms
  };
}

/**
 * Merge a video-only MP4 and a separate audio MP4 into a single MP4 container.
 * @param {string} videoPath
 * @param {string} audioSourcePath
 * @param {string} outputPath
 * @returns {Promise<string>}
 */
export async function mergeVideoAndAudio(videoPath, audioSourcePath, outputPath) {
  await ensureDir(path.dirname(outputPath));

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-i',
    audioSourcePath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c',
    'copy',
    '-shortest',
    outputPath
  ]);

  return outputPath;
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
