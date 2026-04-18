import OpenAI from 'openai';

import { env } from '../config/env.js';

let sharedClient = null;

/**
 * Return a shared OpenAI client if credentials are configured.
 * @returns {OpenAI | null}
 */
export function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  if (!sharedClient) {
    sharedClient = new OpenAI({
      apiKey: env.OPENAI_API_KEY
    });
  }

  return sharedClient;
}
