# instagram-reels-pipeline

Local-first Node.js pipeline for:

1. processing Instagram Reel URLs you explicitly provide,
2. running budgeted reference discovery from your own keyword and creator seeds,
3. extracting reusable hook/body/CTA patterns,
4. generating reference-grounded Reel plans,
5. exporting results to filesystem-first JSON bundles and optional Notion sync outputs.

## Compliance

Only process content you are authorized to access, and make sure your usage complies with Instagram's terms and applicable law.

- URL ingestion only processes URLs you explicitly place in `data/input/reels.txt`
- discovery is seed-based and budgeted from `data/input/keywords.txt` and `data/input/creators.json`
- this project does not use Chrome extensions
- this project does not call private Instagram endpoints directly

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install Playwright Chromium:

   ```bash
   npx playwright install chromium
   ```

3. Install FFmpeg and ffprobe, then verify they are available:

   ```bash
   ffmpeg -version
   ffprobe -version
   ```

4. Create `.env` from the example:

   Windows:

   ```bash
   copy .env.example .env
   ```

   macOS/Linux:

   ```bash
   cp .env.example .env
   ```

5. Fill `.env` with the values you need.

## Environment

```env
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5.2
TRANSCRIPT_LANGUAGE=ko
FRAME_INTERVAL_SECONDS=1
PLAYWRIGHT_HEADLESS=false
FFMPEG_PATH=
FFPROBE_PATH=
DISCOVERY_MAX_SCROLLS_PER_SOURCE=8
DISCOVERY_MAX_CANDIDATES_PER_KEYWORD=80
DISCOVERY_MAX_REELS_PER_CREATOR=24
DISCOVERY_MAX_CANDIDATES_TOTAL=400
DISCOVERY_RUN_SOFT_LIMIT_MINUTES=0
DISCOVERY_KEYWORD_DELAY_MS=1200
GENERATION_DEFAULT_COUNT=10
GENERATION_REFERENCE_MODE=conservative
NOTION_API_KEY=
NOTION_REFERENCE_DB_ID=
NOTION_PLAN_DB_ID=
```

## Login Flow

Run the one-time login flow:

```bash
npm run login
```

That script:

- launches Playwright in headed mode
- opens Instagram login
- lets you sign in manually
- saves storage state to `data/auth/storageState.json`

Re-run it whenever Instagram expires your session.

## Input Files

### Direct Reel URLs

`data/input/reels.txt`

- one URL per line
- blank lines ignored
- lines starting with `#` ignored

Example:

```text
# authorized reel URLs
https://www.instagram.com/reels/SHORTCODE/
```

### Discovery Keywords

`data/input/keywords.txt`

Example:

```text
beauty
skin care
makeup tips
```

### Creator Seeds

`data/input/creators.json`

Example:

```json
[
  "https://www.instagram.com/yuris__c/",
  {
    "url": "https://www.instagram.com/creator_handle/",
    "niche": "beauty",
    "priority": 3,
    "maxReels": 30
  }
]
```

### Campaign Briefs

`data/input/campaigns.json`

Example:

```json
[
  {
    "id": "weekly-beauty",
    "enabled": true,
    "profileId": "default",
    "keywords": ["beauty"],
    "generationMode": "conservative",
    "transformationIntensity": "very_light",
    "referenceCount": 12,
    "generateCount": 10,
    "schedule": {
      "type": "weekly",
      "days": [1, 3, 5],
      "hour": 9,
      "minute": 0,
      "timezone": "Asia/Seoul"
    }
  }
]
```

## Commands

- `npm run login`: save Instagram auth state locally
- `npm run run`: ingest URLs from `data/input/reels.txt`
- `npm start`: alias for `npm run run`
- `npm run discover`: collect candidate Reel URLs from keyword/creator seeds with checkpointing
- `npm run discover -- --resume`: resume the latest unfinished discovery run
- `npm run discover -- --run <run_id>`: resume a specific discovery run
- `npm run discover -- --max-sources 3`: process only a few sources in the current pass
- `npm run discover -- --creator https://www.instagram.com/yuris__c/ --creator-only`: scan one manually selected creator's Reels tab only
- `npm run harvest -- --limit 20`: ingest top discovery candidates into the data lake
- `npm run analyze`: extract signals, hook/body/CTA structure, and rebuild libraries
- `npm run generate`: generate reference-grounded script packages from campaigns
- `npm run publish`: export planning assets and optionally sync to Notion
- `npm run schedule -- --days 21`: build a forward publish queue and optionally sync dates to Notion

## Practical Workflow

### 1. Manual login

```bash
npm run login
```

### 2. Direct URL processing

```bash
npm run run
```

### 3. Seeded discovery

```bash
npm run discover
npm run discover -- --resume
npm run harvest -- --limit 20
```

### 3a. Manually curated creator discovery

If you already know a promising personal account, you can skip noisy keyword search and scan only that creator's Reels tab:

```bash
npm run discover -- --creator https://www.instagram.com/yuris__c/ --creator-only --max-sources 1
```

### 4. Reference analysis

```bash
npm run analyze
```

### 5. Script generation

```bash
npm run generate
```

### 6. Optional publish + schedule

```bash
npm run publish
npm run schedule -- --days 14
```

## Output Layout

```text
data/
  auth/
    storageState.json
  discovery/
    runs/
      <run_id>/
        run.json
        checkpoints/
          state.json
        frontier.jsonl
        visited.jsonl
        candidates.jsonl
        ranked.json
        harvest_selection.json
        harvest.json
  input/
    reels.txt
    keywords.txt
    creators.json
    campaigns.json
  libraries/
    hooks.jsonl
    bodies.jsonl
    ctas.jsonl
    portability.jsonl
    portable_references.json
    conditional_references.json
    non_portable_references.json
    visual_patterns.jsonl
    editing_patterns.jsonl
    ranked_references.json
  planning/
    profiles/
      default.json
    runs/
      <run_id>/
        <campaign>-brief.json
        <campaign>-selected_refs.json
        packages/
          <script_id>.production.json
          <script_id>.production.md
        scripts/
          <script_id>.json
          <script_id>.md
  publish/
    notion/
      <run_id>-export.json
      <run_id>-publish.json
      plan-sync.json
      reference-sync.json
    schedules/
      latest.json
      <run_id>.json
  reels/
    <reel_id>/
      source.json
      meta.json
      analysis/
        signals.json
        structure.json
        portability.json
        hook.json
        body.json
        cta.json
        editing.json
        summary.md
      media/
        video.mp4
        audio.mp3
        frames/
          frame-0001.jpg
      transcript/
        transcript.json
        transcript.txt
      manifest.json
```

## What Gets Saved

- `source.json`: raw page-visible data from the logged-in browser session
- `meta.json`: normalized metadata
- `media/video.mp4`: downloadable Reel media when available from the logged-in context
- `media/audio.mp3`: FFmpeg-extracted audio
- `media/frames/`: extracted still frames
- `transcript/transcript.json`: raw OpenAI transcription response
- `transcript/transcript.txt`: plain text transcript
- `analysis/signals.json`: normalized reference signals and rough performance proxy
- `analysis/structure.json`: hook/body/CTA/visual/editing breakdown
- `analysis/portability.json`: portability rubric scores, label, reuse guidance, and dependency risks
- `libraries/*.jsonl`: reusable reference library slices
- `planning/runs/*/scripts/*.json|.md`: generated reference-grounded content plans
- `planning/runs/*/packages/*.production.json|.md`: shoot-ready packages with scene plan, checklist, and local reference asset paths

## Notion Sync

Notion sync is optional.

Fill these env values if you want it:

- `NOTION_API_KEY`
- `NOTION_REFERENCE_DB_ID`
- `NOTION_PLAN_DB_ID`

The sync layer uses best-effort property matching against your database schema. It works best when your databases include familiar property names such as `Name`, `Status`, `Campaign`, `Profile`, `Hook`, `CTA`, `Score`, `URL`, or `Due Date`.

## Content Guardrail

Generation defaults to conservative assembly mode.

- default behavior is reference-led composition, not freeform ideation
- generated scenes carry source reference ids and source sections
- transformation intensity defaults to `very_light`
- switch to a more assisted mode only when you explicitly want more rewriting

References are also scored for portability before generation.

- high views alone are not enough
- the system scores structure, information utility, proof strength, and dependency risk
- each reference is labeled `portable`, `conditional`, or `non_portable`
- generation prefers `portable` and `conditional` references by default

## Limitations

- Instagram DOM and UI can change at any time.
- Discovery is best-effort from visible logged-in browser pages, not a guaranteed exhaustive search.
- Discovery runs are resumable and keep checkpoints, but Instagram can still interrupt long sessions with login, rate, or UI changes.
- Download only works when a usable media URL is exposed inside the logged-in browser context.
- Some Reels expose split or indirect media patterns that may fail cleanly and be recorded in `manifest.json`.
- Reference decomposition and script generation are grounded in harvested data, but a human should still review outputs before publishing.
- No database is included yet; the source of truth stays on the filesystem.
