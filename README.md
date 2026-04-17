# instagram-reels-pipeline

Local-first Node.js pipeline for processing a user-provided list of Instagram Reel URLs that you are authorized to access.

It opens each Reel in a real Playwright browser session, reuses saved login state, captures page-visible metadata, attempts media persistence only when a direct media URL is available from the logged-in browser context, extracts audio, sends audio to OpenAI speech-to-text, extracts frames with FFmpeg, and saves everything under a JSON-centered filesystem layout.

## Compliance

Only process content that you are authorized to access, and make sure your usage complies with Instagram's terms and applicable law. This project only reads URLs explicitly listed by you in `data/input/reels.txt`; it does not perform discovery or crawl Instagram.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install Playwright Chromium:

   ```bash
   npx playwright install chromium
   ```

3. Install FFmpeg and ffprobe, then verify they are on your `PATH`:

   ```bash
   ffmpeg -version
   ffprobe -version
   ```

4. Create `.env` from the example and fill in your OpenAI API key:

   ```bash
   copy .env.example .env
   ```

   On macOS/Linux:

   ```bash
   cp .env.example .env
   ```

## Environment

`.env.example` contains:

```env
OPENAI_API_KEY=
TRANSCRIPT_LANGUAGE=ko
FRAME_INTERVAL_SECONDS=1
PLAYWRIGHT_HEADLESS=false
```

## Login Flow

Run the one-time login script:

```bash
npm run login
```

That script:

- launches Playwright in headed mode
- opens Instagram login
- lets you sign in manually
- saves Playwright storage state to `data/auth/storageState.json`

Refresh the auth state again whenever Instagram logs you out or redirects pipeline runs back to login.

## Input File

Add one Reel URL per line to `data/input/reels.txt`.

- blank lines are ignored
- lines starting with `#` are ignored
- only URLs you explicitly provide are processed

Example:

```text
# One Reel URL per line
https://www.instagram.com/reel/SHORTCODE/
```

## Run

Process all URLs in `data/input/reels.txt`:

```bash
npm run run
```

Or:

```bash
npm start
```

## Output Layout

```text
data/
  input/
    reels.txt
  auth/
    storageState.json
  reels/
    <reel_id>/
      source.json
      meta.json
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

- `source.json`: raw page-level data gathered from the logged-in browser session
- `meta.json`: normalized metadata with nulls for missing fields
- `media/video.mp4`: Reel video when a direct downloadable media URL is available from the browser context
- `media/audio.mp3`: FFmpeg-extracted audio
- `media/frames/`: FFmpeg-extracted still frames
- `transcript/transcript.json`: raw OpenAI transcription response
- `transcript/transcript.txt`: plain text transcript
- `manifest.json`: step status, timestamps, and errors

## Limitations

- Instagram UI and DOM structure can change, so visible metadata extraction is best-effort.
- The pipeline does not use private Instagram endpoints.
- Video download only succeeds when a direct media URL is exposed to the logged-in browser context.
- If Instagram only exposes unsupported or indirect media access patterns, the pipeline records the failure in `manifest.json` and continues.
- No database is included yet; storage is filesystem-only.

## Commands

- `npm run login`: manual Instagram login and auth-state save
- `npm run run`: run the pipeline for every URL in `data/input/reels.txt`
- `npm start`: alias for `npm run run`
