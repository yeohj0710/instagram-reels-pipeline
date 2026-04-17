import fs from 'node:fs';

import OpenAI from 'openai';

import { env } from '../config/env.js';
import { writeJson, writeText } from '../utils/fs.js';

/**
 * Transcribe an audio file with the OpenAI speech-to-text API.
 * @param {string} audioPath
 * @param {string} outputJsonPath
 * @param {string} outputTextPath
 * @param {{ language?: string }} options
 * @returns {Promise<Record<string, unknown>>}
 */
export async function transcribeAudioFile(audioPath, outputJsonPath, outputTextPath, options = {}) {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Skipping transcription.');
  }

  const client = new OpenAI({
    apiKey: env.OPENAI_API_KEY
  });

  const transcript = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: 'gpt-4o-transcribe',
    language: options.language ?? env.TRANSCRIPT_LANGUAGE,
    response_format: 'json'
  });

  const text = typeof transcript.text === 'string' ? transcript.text.trim() : '';

  await writeJson(outputJsonPath, transcript);
  await writeText(outputTextPath, text ? `${text}\n` : '');

  return transcript;
}
