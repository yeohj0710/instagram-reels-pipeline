import { readFile } from 'node:fs/promises';

import { createWorker } from 'tesseract.js';

import { env } from '../config/env.js';
import { getOpenAIClient } from '../openai/client.js';
import { normalizeWhitespace } from '../utils/text.js';

const OCR_LANG = 'kor+eng';
const NOISE_PATTERN =
  /^(?:\d+[.,\d]*|좋아요|댓글|공유|저장|조회|팔로워|팔로우|reel|instagram|follow|like|comment|share|save)$/i;

function normalizeOcrText(value) {
  return normalizeWhitespace(value)
    .replace(/[|¦]/g, 'I')
    .replace(/\s*([?!.,:])\s*/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableOcrLine(text) {
  const normalized = normalizeOcrText(text);

  if (!normalized || normalized.length < 4 || normalized.length > 42) {
    return false;
  }

  if (NOISE_PATTERN.test(normalized)) {
    return false;
  }

  return /[\p{L}\p{N}]/u.test(normalized);
}

function isStrongThumbnailTitle(text) {
  const normalized = normalizeOcrText(text);

  if (!isUsableOcrLine(normalized)) {
    return false;
  }

  if (normalized.length >= 16) {
    return true;
  }

  if (/\d/.test(normalized)) {
    return true;
  }

  if (/[?!:]/.test(normalized)) {
    return true;
  }

  return false;
}

function scoreLine(line, imageWidth, imageHeight) {
  const text = normalizeOcrText(line.text);
  const bbox = line.bbox ?? {};
  const width = Math.max(1, Number(bbox.x1 ?? 0) - Number(bbox.x0 ?? 0));
  const height = Math.max(1, Number(bbox.y1 ?? 0) - Number(bbox.y0 ?? 0));
  const centerX = (Number(bbox.x0 ?? 0) + Number(bbox.x1 ?? 0)) / 2;
  const centerY = (Number(bbox.y0 ?? 0) + Number(bbox.y1 ?? 0)) / 2;
  const centeredness = 1 - Math.min(Math.abs(centerX - imageWidth / 2) / (imageWidth / 2), 1);
  const lowerBand = centerY >= imageHeight * 0.42 && centerY <= imageHeight * 0.88 ? 1 : 0;
  const sizeScore = Math.min(height / Math.max(imageHeight * 0.03, 1), 3);
  const widthScore = Math.min(width / Math.max(imageWidth * 0.3, 1), 2);
  const confidence = Number(line.confidence ?? 0) / 100;
  const nonAsciiBonus = /[가-힣]/.test(text) ? 0.25 : 0;

  return centeredness * 2 + lowerBand * 2 + sizeScore + widthScore + confidence * 2 + nonAsciiBonus;
}

function mergeCandidateLines(lines, imageWidth, imageHeight) {
  const scored = lines
    .filter((line) => isUsableOcrLine(line.text))
    .map((line) => ({
      ...line,
      normalizedText: normalizeOcrText(line.text),
      score: scoreLine(line, imageWidth, imageHeight)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return Number(left.bbox?.y0 ?? 0) - Number(right.bbox?.y0 ?? 0);
    });

  if (scored.length === 0) {
    return null;
  }

  const primary = scored[0];
  const primaryY = Number(primary.bbox?.y0 ?? 0);
  const merged = scored
    .filter((line) => Math.abs(Number(line.bbox?.y0 ?? 0) - primaryY) < imageHeight * 0.12)
    .sort((left, right) => Number(left.bbox?.y0 ?? 0) - Number(right.bbox?.y0 ?? 0))
    .slice(0, 3)
    .map((line) => line.normalizedText);

  const title = normalizeWhitespace(merged.join(' '));

  if (!isStrongThumbnailTitle(title)) {
    return null;
  }

  return {
    text: title,
    confidence: Number(primary.confidence ?? 0)
  };
}

async function extractTitleWithVision(framePaths) {
  const client = getOpenAIClient();
  const targets = (Array.isArray(framePaths) ? framePaths : []).filter(Boolean).slice(0, 3);

  if (!client || !env.OPENAI_TEXT_MODEL || targets.length === 0) {
    return null;
  }

  try {
    const imageContents = await Promise.all(
      targets.map(async (framePath) => {
        const imageBuffer = await readFile(framePath);
        return {
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${imageBuffer.toString('base64')}`
          }
        };
      })
    );

    const completion = await client.chat.completions.create({
      model: env.OPENAI_TEXT_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'developer',
          content:
            'Read the provided reel frames and return only the large overlay headline text used as the reel title. Prefer the main thumbnail-style phrase. Ignore usernames, counters, UI, and small captions. Return plain text only.'
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'These are early frames from the same reel. Return only the main large overlay title text.'
            },
            ...imageContents
          ]
        }
      ]
    });

    const text = normalizeOcrText(completion.choices[0]?.message?.content ?? '');

    if (!isStrongThumbnailTitle(text)) {
      return null;
    }

    return {
      text,
      confidence: 100,
      framePath: targets[0]
    };
  } catch {
    return null;
  }
}

/**
 * Extract a title-like overlay text from the first few extracted frames.
 * @param {string[]} framePaths
 * @returns {Promise<{ text: string, confidence: number, framePath: string } | null>}
 */
export async function extractTitleFromFrames(framePaths) {
  const targets = (Array.isArray(framePaths) ? framePaths : []).filter(Boolean).slice(0, 3);

  if (targets.length === 0) {
    return null;
  }

  const worker = await createWorker(OCR_LANG);

  try {
    let best = null;

    for (const framePath of targets) {
      const result = await worker.recognize(framePath);
      const imageWidth = Number(result?.data?.width ?? 1080);
      const imageHeight = Number(result?.data?.height ?? 1920);
      const candidate = mergeCandidateLines(result?.data?.lines ?? [], imageWidth, imageHeight);

      if (!candidate) {
        continue;
      }

      const scoredCandidate = {
        ...candidate,
        framePath,
        score: candidate.confidence + candidate.text.length * 0.2
      };

      if (!best || scoredCandidate.score > best.score) {
        best = scoredCandidate;
      }
    }

    if (best) {
      return {
        text: best.text,
        confidence: best.confidence,
        framePath: best.framePath
      };
    }

    const visionResult = await extractTitleWithVision(targets);

    if (visionResult?.text) {
      return visionResult;
    }

    return null;
  } finally {
    await worker.terminate();
  }
}
