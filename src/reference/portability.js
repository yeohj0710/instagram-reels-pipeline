import { normalizeWhitespace } from '../utils/text.js';

const INSTRUCTION_PATTERNS = [
  /\bhow to\b/i,
  /\btip\b/i,
  /\btips\b/i,
  /\bmistake\b/i,
  /\bmistakes\b/i,
  /\bstep\b/i,
  /\bsteps\b/i,
  /\broutine\b/i,
  /\btutorial\b/i,
  /\bguide\b/i,
  /\bhack\b/i,
  /\bchecklist\b/i,
  /방법/,
  /팁/,
  /실수/,
  /순서/,
  /루틴/,
  /가이드/,
  /꿀팁/,
  /정리/
];

const PROOF_PATTERNS = [
  /\bbefore\b/i,
  /\bafter\b/i,
  /\bcomparison\b/i,
  /\bcompare\b/i,
  /\bresult\b/i,
  /\bresults\b/i,
  /\btested\b/i,
  /\btest\b/i,
  /\breview\b/i,
  /\bwear test\b/i,
  /\bexperiment\b/i,
  /\bproof\b/i,
  /전후/,
  /비교/,
  /결과/,
  /테스트/,
  /실험/,
  /리뷰/,
  /후기/,
  /검증/
];

const PRODUCT_PATTERNS = [
  /\bproduct\b/i,
  /\bserum\b/i,
  /\bcream\b/i,
  /\btoner\b/i,
  /\bcushion\b/i,
  /\bfoundation\b/i,
  /\bconcealer\b/i,
  /\blip(?:stick| gloss| tint)?\b/i,
  /\bblush\b/i,
  /\bpalette\b/i,
  /\bsunscreen\b/i,
  /\bspf\b/i,
  /제품/,
  /쿠션/,
  /세럼/,
  /크림/,
  /토너/,
  /파데/,
  /파운데이션/,
  /컨실러/,
  /립/,
  /틴트/,
  /블러셔/,
  /선크림/
];

const BRAND_PATTERNS = [
  /\b#ad\b/i,
  /\bsponsored\b/i,
  /\bpaid partnership\b/i,
  /\bpartnered\b/i,
  /\bcollab\b/i,
  /\baffiliate\b/i,
  /\bdiscount code\b/i,
  /\bcode\b/i,
  /\blink in bio\b/i,
  /광고/,
  /협찬/,
  /제공/,
  /브랜드/,
  /콜라보/,
  /제휴/,
  /링크/,
  /코드/
];

const TREND_PATTERNS = [
  /\btrend\b/i,
  /\btrending\b/i,
  /\bviral\b/i,
  /\bchallenge\b/i,
  /\bfyp\b/i,
  /\bfor you\b/i,
  /\breels\b/i,
  /\btrend alert\b/i,
  /\bviral audio\b/i,
  /유행/,
  /밈/,
  /챌린지/,
  /떡상/,
  /바이럴/,
  /트렌드/
];

const PERSONA_PATTERNS = [
  /\bi\b/i,
  /\bmy\b/i,
  /\bme\b/i,
  /\bmy face\b/i,
  /\bmy skin\b/i,
  /\bas a\b/i,
  /저는/,
  /제가/,
  /내가/,
  /저의/,
  /언니/,
  /누나/,
  /오빠/,
  /형/
];

const APPEARANCE_PATTERNS = [
  /\bpretty\b/i,
  /\bbeautiful\b/i,
  /\bgorgeous\b/i,
  /\bstunning\b/i,
  /\bhot\b/i,
  /\bsexy\b/i,
  /\bcute\b/i,
  /\bglow up\b/i,
  /\bvisual\b/i,
  /예쁘/,
  /예뻐/,
  /미모/,
  /존예/,
  /여신/,
  /잘생/,
  /섹시/,
  /귀엽/
];

const PRODUCTION_PATTERNS = [
  /\bcinematic\b/i,
  /\btransition\b/i,
  /\bmotion graphics\b/i,
  /\bstudio\b/i,
  /\bcolor grade\b/i,
  /\bmulti cam\b/i,
  /시네마틱/,
  /트랜지션/,
  /스튜디오/,
  /조명/,
  /고퀄/,
  /연출/
];

function clampScore(value) {
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeScore(value) {
  return (clampScore(value) - 1) / 4;
}

function invertRisk(value) {
  return 1 - normalizeScore(value);
}

function countPatternHits(text, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function hasArchetype(structure, patterns) {
  const archetype = normalizeWhitespace(structure?.contentArchetype ?? '').toLowerCase();
  return patterns.some((pattern) => archetype.includes(pattern));
}

function buildSummaryText(bundle, structure) {
  return normalizeWhitespace(
    [
      bundle.meta?.caption,
      bundle.transcriptText,
      structure?.hook?.text,
      structure?.body?.summary,
      structure?.cta?.text,
      Array.isArray(bundle.source?.visibleTexts) ? bundle.source.visibleTexts.slice(0, 80).join(' ') : ''
    ].join(' ')
  );
}

function scoreStructureStrength(structure) {
  const hook = normalizeWhitespace(structure?.hook?.text ?? '');
  const bodySummary = normalizeWhitespace(structure?.body?.summary ?? '');
  const beats = Array.isArray(structure?.body?.beats) ? structure.body.beats.length : 0;
  const cta = normalizeWhitespace(structure?.cta?.text ?? '');

  let score = 1;

  if (hook.length >= 8) {
    score += 1;
  }

  if (bodySummary.length >= 40 || beats >= 2) {
    score += 1;
  }

  if (beats >= 3) {
    score += 1;
  }

  if (cta.length >= 6) {
    score += 1;
  }

  return clampScore(score);
}

function scoreInformationUtility(bundle, signals, structure, allText) {
  const infoHits = countPatternHits(allText, INSTRUCTION_PATTERNS);
  let score = 1;

  if (infoHits >= 1) {
    score += 1;
  }

  if (infoHits >= 3) {
    score += 1;
  }

  if ((signals?.transcriptLength ?? 0) >= 120 || normalizeWhitespace(bundle.meta?.caption ?? '').length >= 90) {
    score += 1;
  }

  if (hasArchetype(structure, ['educational', 'tutorial', 'comparison', 'problem', 'explanation'])) {
    score += 1;
  }

  return clampScore(score);
}

function scoreProofStrength(structure, allText) {
  const proofHits = countPatternHits(allText, PROOF_PATTERNS);
  const beats = Array.isArray(structure?.body?.beats) ? structure.body.beats.length : 0;
  let score = 1;

  if (proofHits >= 1) {
    score += 1;
  }

  if (proofHits >= 3) {
    score += 1;
  }

  if (beats >= 2 && proofHits >= 1) {
    score += 1;
  }

  if (hasArchetype(structure, ['comparison', 'review', 'test'])) {
    score += 1;
  }

  return clampScore(score);
}

function scorePersonaDependency(bundle, signals, structure, infoUtility, proofStrength, allText) {
  const personaHits = countPatternHits(allText, PERSONA_PATTERNS);
  const captionLength = normalizeWhitespace(bundle.meta?.caption ?? '').length;
  let score = 1;

  if (personaHits >= 2) {
    score += 1;
  }

  if (infoUtility <= 2 && proofStrength <= 2) {
    score += 1;
  }

  if (captionLength > 0 && captionLength < 40 && (signals?.transcriptLength ?? 0) < 120) {
    score += 1;
  }

  if (scoreStructureStrength(structure) <= 2 && (signals?.performanceScore ?? 0) >= 60) {
    score += 1;
  }

  return clampScore(score);
}

function scoreAppearanceDependency(infoUtility, proofStrength, allText) {
  const appearanceHits = countPatternHits(allText, APPEARANCE_PATTERNS);
  let score = 1;

  if (appearanceHits >= 1) {
    score += 1;
  }

  if (appearanceHits >= 2) {
    score += 1;
  }

  if (appearanceHits >= 1 && infoUtility <= 2) {
    score += 1;
  }

  if (appearanceHits >= 1 && proofStrength <= 2) {
    score += 1;
  }

  return clampScore(score);
}

function scoreProductDependency(allText) {
  const productHits = countPatternHits(allText, PRODUCT_PATTERNS);
  const commerceHits = countPatternHits(allText, BRAND_PATTERNS.filter((pattern, index) => index >= 5));
  let score = 1;

  if (productHits >= 1) {
    score += 1;
  }

  if (productHits >= 3) {
    score += 1;
  }

  if (commerceHits >= 1) {
    score += 1;
  }

  if (/\breview\b|\bwear test\b|\bunboxing\b|리뷰|후기|언박싱/i.test(allText)) {
    score += 1;
  }

  return clampScore(score);
}

function scoreBrandDependency(allText) {
  const brandHits = countPatternHits(allText, BRAND_PATTERNS);
  let score = 1;

  if (brandHits >= 1) {
    score += 2;
  }

  if (brandHits >= 3) {
    score += 1;
  }

  if (/\bcode\b|\blink in bio\b|코드|링크/i.test(allText)) {
    score += 1;
  }

  return clampScore(score);
}

function scoreProductionDependency(structure, allText) {
  const brollSlots = Array.isArray(structure?.editing?.brollSlots) ? structure.editing.brollSlots.length : 0;
  const shotPattern = Array.isArray(structure?.visuals?.shotPattern) ? structure.visuals.shotPattern.length : 0;
  const productionHits = countPatternHits(allText, PRODUCTION_PATTERNS);
  let score = 1;

  if (normalizeWhitespace(structure?.editing?.cutFrequency ?? '').toLowerCase() === 'high') {
    score += 1;
  }

  if (brollSlots >= 2) {
    score += 1;
  }

  if (shotPattern >= 3) {
    score += 1;
  }

  if (productionHits >= 1) {
    score += 1;
  }

  return clampScore(score);
}

function scoreTrendDependency(allText, signals) {
  const trendHits = countPatternHits(allText, TREND_PATTERNS);
  let score = 1;

  if (trendHits >= 1) {
    score += 1;
  }

  if (trendHits >= 2) {
    score += 1;
  }

  if (trendHits >= 3) {
    score += 1;
  }

  if ((signals?.durationSeconds ?? 0) > 0 && (signals?.durationSeconds ?? 0) <= 8 && trendHits >= 1) {
    score += 1;
  }

  return clampScore(score);
}

function buildPortabilityScore(scores) {
  const weighted =
    normalizeScore(scores.structureStrength) * 1.3 +
    normalizeScore(scores.informationUtility) * 1.5 +
    normalizeScore(scores.proofStrength) * 1.0 +
    invertRisk(scores.personaDependency) * 0.9 +
    invertRisk(scores.appearanceDependency) * 0.7 +
    invertRisk(scores.productDependency) * 1.2 +
    invertRisk(scores.brandDependency) * 0.9 +
    invertRisk(scores.productionDependency) * 0.7 +
    invertRisk(scores.trendDependency) * 0.6;

  return Math.round((weighted / 8.8) * 100);
}

function classifyPortability(scores, portabilityScore) {
  const highRisk = Math.max(
    scores.personaDependency,
    scores.appearanceDependency,
    scores.productDependency,
    scores.brandDependency
  );

  if (
    portabilityScore >= 70 &&
    scores.structureStrength >= 3 &&
    scores.informationUtility >= 3 &&
    highRisk <= 3
  ) {
    return 'portable';
  }

  if (
    portabilityScore < 45 ||
    (highRisk >= 5 && scores.informationUtility <= 2) ||
    (scores.brandDependency >= 5 && scores.productDependency >= 4)
  ) {
    return 'non_portable';
  }

  return 'conditional';
}

function buildRecommendedReuse(scores, structure) {
  const reusable = [];
  const avoid = [];

  if (scores.structureStrength >= 3) {
    reusable.push('hook_structure', 'body_beat_order');
  }

  if (scores.proofStrength >= 3) {
    reusable.push('proof_pattern');
  }

  if (normalizeWhitespace(structure?.cta?.text ?? '') && scores.productDependency <= 3 && scores.brandDependency <= 3) {
    reusable.push('cta_pattern');
  }

  if (scores.productionDependency <= 3) {
    reusable.push('editing_rhythm');
  }

  if (scores.productDependency >= 4) {
    avoid.push('product_specific_claims');
  }

  if (scores.brandDependency >= 4) {
    avoid.push('brand_led_framing');
  }

  if (scores.personaDependency >= 4 || scores.appearanceDependency >= 4) {
    avoid.push('persona_or_appearance_led_framing');
  }

  if (scores.trendDependency >= 4) {
    avoid.push('trend_only_hooking');
  }

  return {
    reusable: Array.from(new Set(reusable)),
    avoid: Array.from(new Set(avoid))
  };
}

function buildReasons(scores, label) {
  const positives = [];
  const risks = [];

  if (scores.structureStrength >= 4) {
    positives.push('Structure is explicit enough to copy as a repeatable format.');
  }

  if (scores.informationUtility >= 4) {
    positives.push('Information value looks strong enough to justify saves and shares.');
  }

  if (scores.proofStrength >= 4) {
    positives.push('The content appears to include proof, comparison, or verifiable demonstration.');
  }

  if (scores.personaDependency >= 4) {
    risks.push('Performance may depend heavily on the creator persona rather than the format itself.');
  }

  if (scores.appearanceDependency >= 4) {
    risks.push('Visual attractiveness or appearance-led appeal may be doing a large share of the work.');
  }

  if (scores.productDependency >= 4) {
    risks.push('The concept appears tightly tied to a specific product or shopping intent.');
  }

  if (scores.brandDependency >= 4) {
    risks.push('Brand, sponsorship, or purchase context appears to be part of the performance driver.');
  }

  if (scores.productionDependency >= 4) {
    risks.push('Reproducing the result may require more editing or production than a typical creator workflow.');
  }

  if (scores.trendDependency >= 4) {
    risks.push('A time-sensitive trend or viral format may be carrying part of the performance.');
  }

  if (label === 'portable' && positives.length === 0) {
    positives.push('No dominant portability blockers were detected.');
  }

  if (label === 'non_portable' && risks.length === 0) {
    risks.push('Multiple weak portability signals indicate this may not transfer well.');
  }

  return { positives, risks };
}

/**
 * Evaluate whether a reference is reusable beyond the original creator/product context.
 * @param {{ reelId: string, meta: Record<string, unknown>, source: Record<string, unknown>, transcriptText: string }} bundle
 * @param {Record<string, unknown>} signals
 * @param {Record<string, unknown>} structure
 * @returns {Record<string, unknown>}
 */
export function evaluateReferencePortability(bundle, signals, structure) {
  const allText = buildSummaryText(bundle, structure);

  const scores = {
    structureStrength: scoreStructureStrength(structure),
    informationUtility: scoreInformationUtility(bundle, signals, structure, allText),
    proofStrength: scoreProofStrength(structure, allText),
    personaDependency: 1,
    appearanceDependency: 1,
    productDependency: scoreProductDependency(allText),
    brandDependency: scoreBrandDependency(allText),
    productionDependency: scoreProductionDependency(structure, allText),
    trendDependency: scoreTrendDependency(allText, signals)
  };

  scores.personaDependency = scorePersonaDependency(
    bundle,
    signals,
    structure,
    scores.informationUtility,
    scores.proofStrength,
    allText
  );
  scores.appearanceDependency = scoreAppearanceDependency(
    scores.informationUtility,
    scores.proofStrength,
    allText
  );

  const portabilityScore = buildPortabilityScore(scores);
  const portabilityLabel = classifyPortability(scores, portabilityScore);
  const reuse = buildRecommendedReuse(scores, structure);
  const reasons = buildReasons(scores, portabilityLabel);
  const reproducibilityCost = clampScore(
    (scores.personaDependency +
      scores.appearanceDependency +
      scores.productDependency +
      scores.brandDependency +
      scores.productionDependency +
      scores.trendDependency) /
      6
  );

  return {
    referenceId: bundle.reelId,
    generatedAt: new Date().toISOString(),
    rubricVersion: 'portability-v1',
    portabilityScore,
    portabilityLabel,
    reproducibilityCost,
    scores,
    reuse,
    reasons,
    reviewQuestions: [
      'Would this still work if a less-known creator shot it?',
      'Would this still work without the exact same product or brand context?',
      'Can the hook-body-CTA structure transfer without importing unsupported claims?'
    ],
    summary:
      portabilityLabel === 'portable'
        ? 'The reference appears structurally reusable with limited dependence on creator-specific advantages.'
        : portabilityLabel === 'conditional'
          ? 'The reference has reusable parts, but some performance drivers appear tied to context, product, brand, or execution.'
          : 'The reference appears risky to reuse because performance may depend more on non-transferable factors than on reusable structure.'
  };
}
