import path from 'node:path';

import { ensureDir, removeDir } from '../utils/fs.js';
import { runCommand } from './media.js';

/**
 * Extract JPEG frames every N seconds with FFmpeg.
 * @param {string} videoPath
 * @param {string} framesDir
 * @param {number} intervalSeconds
 * @returns {Promise<string>}
 */
export async function extractFrames(videoPath, framesDir, intervalSeconds) {
  await removeDir(framesDir);
  await ensureDir(framesDir);

  await runCommand('ffmpeg', [
    '-y',
    '-i',
    videoPath,
    '-vf',
    `fps=1/${intervalSeconds}`,
    '-q:v',
    '2',
    path.join(framesDir, 'frame-%04d.jpg')
  ]);

  return framesDir;
}
