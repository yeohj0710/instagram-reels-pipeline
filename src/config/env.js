import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env'), quiet: true });

const envSchema = z.object({
  OPENAI_API_KEY: z.string().optional().default(''),
  TRANSCRIPT_LANGUAGE: z.string().trim().min(1).default('ko'),
  FRAME_INTERVAL_SECONDS: z.coerce.number().positive().default(1),
  FFMPEG_PATH: z.string().optional().default(''),
  FFPROBE_PATH: z.string().optional().default(''),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .default('false')
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
});

const parsed = envSchema.parse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  TRANSCRIPT_LANGUAGE: process.env.TRANSCRIPT_LANGUAGE ?? 'ko',
  FRAME_INTERVAL_SECONDS: process.env.FRAME_INTERVAL_SECONDS ?? '1',
  FFMPEG_PATH: process.env.FFMPEG_PATH ?? '',
  FFPROBE_PATH: process.env.FFPROBE_PATH ?? '',
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? 'false'
});

export const env = {
  ...parsed,
  OPENAI_API_KEY: parsed.OPENAI_API_KEY.trim() || null,
  FFMPEG_PATH: parsed.FFMPEG_PATH.trim() || null,
  FFPROBE_PATH: parsed.FFPROBE_PATH.trim() || null
};
