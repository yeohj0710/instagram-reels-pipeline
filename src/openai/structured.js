import { zodResponseFormat } from 'openai/helpers/zod';

import { env } from '../config/env.js';
import { getOpenAIClient } from './client.js';

/**
 * Run a structured chat completion and return parsed JSON.
 * @template T
 * @param {{ schema: import('zod').ZodType<T>, schemaName: string, system: string, user: string, temperature?: number }} input
 * @returns {Promise<T | null>}
 */
export async function runStructuredGeneration(input) {
  const client = getOpenAIClient();

  if (!client) {
    return null;
  }

  const completion = await client.chat.completions.parse({
    model: env.OPENAI_TEXT_MODEL,
    temperature: input.temperature ?? 0.4,
    messages: [
      { role: 'developer', content: input.system },
      { role: 'user', content: input.user }
    ],
    response_format: zodResponseFormat(input.schema, input.schemaName)
  });

  return completion.choices[0]?.message?.parsed ?? null;
}
