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
  OPENAI_TEXT_MODEL: z.string().trim().min(1).default('gpt-5.4-nano'),
  TRANSCRIPT_LANGUAGE: z.string().trim().min(1).default('ko'),
  FRAME_INTERVAL_SECONDS: z.coerce.number().positive().default(1),
  FFMPEG_PATH: z.string().optional().default(''),
  FFPROBE_PATH: z.string().optional().default(''),
  DISCOVERY_MAX_SCROLLS_PER_SOURCE: z.coerce.number().int().positive().default(8),
  DISCOVERY_MAX_CANDIDATES_PER_KEYWORD: z.coerce.number().int().positive().default(80),
  DISCOVERY_MAX_REELS_PER_CREATOR: z.coerce.number().int().positive().default(24),
  DISCOVERY_MAX_CANDIDATES_TOTAL: z.coerce.number().int().positive().default(400),
  DISCOVERY_RUN_SOFT_LIMIT_MINUTES: z.coerce.number().nonnegative().default(0),
  DISCOVERY_KEYWORD_DELAY_MS: z.coerce.number().int().nonnegative().default(1200),
  GENERATION_DEFAULT_COUNT: z.coerce.number().int().positive().default(10),
  GENERATION_REFERENCE_MODE: z.enum(['conservative', 'assisted']).default('conservative'),
  NOTION_API_KEY: z.string().optional().default(''),
  NOTION_REFERENCE_DB_ID: z.string().optional().default(''),
  NOTION_PLAN_DB_ID: z.string().optional().default(''),
  PLAYWRIGHT_HEADLESS: z
    .string()
    .optional()
    .default('false')
    .transform((value) => ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()))
});

const parsed = envSchema.parse({
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_TEXT_MODEL: process.env.OPENAI_TEXT_MODEL ?? 'gpt-5.4-nano',
  TRANSCRIPT_LANGUAGE: process.env.TRANSCRIPT_LANGUAGE ?? 'ko',
  FRAME_INTERVAL_SECONDS: process.env.FRAME_INTERVAL_SECONDS ?? '1',
  FFMPEG_PATH: process.env.FFMPEG_PATH ?? '',
  FFPROBE_PATH: process.env.FFPROBE_PATH ?? '',
  DISCOVERY_MAX_SCROLLS_PER_SOURCE: process.env.DISCOVERY_MAX_SCROLLS_PER_SOURCE ?? '8',
  DISCOVERY_MAX_CANDIDATES_PER_KEYWORD: process.env.DISCOVERY_MAX_CANDIDATES_PER_KEYWORD ?? '80',
  DISCOVERY_MAX_REELS_PER_CREATOR: process.env.DISCOVERY_MAX_REELS_PER_CREATOR ?? '24',
  DISCOVERY_MAX_CANDIDATES_TOTAL: process.env.DISCOVERY_MAX_CANDIDATES_TOTAL ?? '400',
  DISCOVERY_RUN_SOFT_LIMIT_MINUTES: process.env.DISCOVERY_RUN_SOFT_LIMIT_MINUTES ?? '0',
  DISCOVERY_KEYWORD_DELAY_MS: process.env.DISCOVERY_KEYWORD_DELAY_MS ?? '1200',
  GENERATION_DEFAULT_COUNT: process.env.GENERATION_DEFAULT_COUNT ?? '10',
  GENERATION_REFERENCE_MODE: process.env.GENERATION_REFERENCE_MODE ?? 'conservative',
  NOTION_API_KEY: process.env.NOTION_API_KEY ?? '',
  NOTION_REFERENCE_DB_ID: process.env.NOTION_REFERENCE_DB_ID ?? '',
  NOTION_PLAN_DB_ID: process.env.NOTION_PLAN_DB_ID ?? '',
  PLAYWRIGHT_HEADLESS: process.env.PLAYWRIGHT_HEADLESS ?? 'false'
});

export const env = {
  ...parsed,
  OPENAI_API_KEY: parsed.OPENAI_API_KEY.trim() || null,
  OPENAI_TEXT_MODEL: parsed.OPENAI_TEXT_MODEL.trim(),
  FFMPEG_PATH: parsed.FFMPEG_PATH.trim() || null,
  FFPROBE_PATH: parsed.FFPROBE_PATH.trim() || null,
  NOTION_API_KEY: parsed.NOTION_API_KEY.trim() || null,
  NOTION_REFERENCE_DB_ID: parsed.NOTION_REFERENCE_DB_ID.trim() || null,
  NOTION_PLAN_DB_ID: parsed.NOTION_PLAN_DB_ID.trim() || null
};
