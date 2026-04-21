# instagram-reels-pipeline

로컬 우선 Instagram Reels 워크스페이스입니다.

이제 기본 구조는 `자동 탐색`이 아니라 아래 흐름입니다.

1. 사람이 `정보 릴스` 링크를 직접 모은다.
2. 사람이 `형식 릴스` 링크를 직접 모은다.
3. 시스템이 기존 다운로드 / 오디오 추출 / 전사 / 구조화 분석을 연결한다.
4. 사람이 선별한 정보 + 형식을 바탕으로 기획안을 만든다.
5. 모든 CRUD는 로컬 웹앱에서 처리한다.

## 바뀐 핵심

- 더 이상 프로젝트의 중심이 `discover/harvest`가 아닙니다.
- 메디컬뷰티 정보 레퍼런스와 형식 레퍼런스를 분리해서 관리합니다.
- 지표는 사람이 직접 확인해서 입력하는 것을 기본으로 둡니다.
- 기존 강점이던 `영상 다운로드 -> 오디오 추출 -> STT -> AI 구조화`는 그대로 재사용합니다.
- `localhost` 웹앱에서 링크 저장, 수정, 삭제, 처리, 분석, 기획안 생성을 한 번에 합니다.

## 빠른 시작

1. 의존성 설치

   ```bash
   npm install
   ```

2. Playwright Chromium 설치

   ```bash
   npx playwright install chromium
   ```

3. FFmpeg / ffprobe 설치 후 확인

   ```bash
   ffmpeg -version
   ffprobe -version
   ```

4. `.env.example`을 `.env`로 복사

   Windows:

   ```bash
   copy .env.example .env
   ```

   macOS/Linux:

   ```bash
   cp .env.example .env
   ```

5. 로그인 세션 저장

   ```bash
   npm run login
   ```

6. 웹앱 실행

   ```bash
npm run dev
   ```

7. 브라우저에서 `http://127.0.0.1:3030` 열기

## 환경 변수

```env
APP_HOST=127.0.0.1
APP_PORT=3030
OPENAI_API_KEY=
OPENAI_TEXT_MODEL=gpt-5.4-nano
TRANSCRIPT_LANGUAGE=ko
FRAME_INTERVAL_SECONDS=1
PLAYWRIGHT_HEADLESS=false
FFMPEG_PATH=
FFPROBE_PATH=
```

## 웹앱 워크플로

### 1. 링크 저장

웹앱 첫 화면에서:

- `정보 릴스` 또는 `형식 릴스` 선택
- Instagram Reel URL 입력
- 제목 / 토픽 / 태그 / 메모 저장

### 2. 처리

각 카드의 `처리` 버튼 또는 상단 `미처리 링크 처리` 버튼을 사용하면:

- 메타 수집
- 비디오 다운로드
- 오디오 추출
- 전사
- 프레임 추출

까지 실행됩니다.

### 3. 분석

`분석` 버튼 또는 상단 `미분석 링크 분석` 버튼을 사용하면:

- 공통 구조 분석
- portability 분석
- 정보 릴스면 `information.json`
- 형식 릴스면 `format.json`

이 생성됩니다.

### 4. 기획안 생성

웹앱 하단의 `기획안 생성` 영역에서:

- 정보 레퍼런스 1개 이상 선택
- 형식 레퍼런스 1개 이상 선택
- 제목 / 토픽 / 매칭 메모 입력

후 생성하면 `data/plans/<plan_id>/` 아래에 저장됩니다.

## CLI

웹 UI가 기본 인터페이스지만, 배치 처리용 CLI도 유지합니다.

- `npm run dev`: CRUD 웹앱 실행
- `npm run app`: `npm run dev` 별칭
- `npm run login`: Instagram 로그인 세션 저장
- `npm run run`: 아직 처리되지 않은 레퍼런스 처리
- `npm run run -- --reel <id>`: 특정 레퍼런스만 처리
- `npm run run -- --url <instagram_url> --collection-type information`: 링크 생성 후 바로 처리
- `npm run analyze`: 아직 분석되지 않은 레퍼런스 분석
- `npm run analyze -- --reel <id>`: 특정 레퍼런스만 분석
- `npm run generate -- --info <id> --format <id>`: 선택한 정보/형식 조합으로 기획안 생성

## 저장 구조

```text
data/
  auth/
    storageState.json
  reels/
    <reel_id>/
      record.json
      source.json
      meta.json
      manifest.json
      media/
        video.mp4
        audio.mp3
        frames/
      transcript/
        transcript.json
        transcript.txt
      analysis/
        signals.json
        structure.json
        portability.json
        information.json
        format.json
        summary.md
  plans/
    <plan_id>/
      plan.json
      plan.md
```

## 파일 의미

### `record.json`

사람이 관리하는 레코드입니다.

- `collectionType`: `information` | `format` | `unassigned`
- `title`, `topic`, `tags`, `notes`
- `manualMetrics`
- `curation.approved`, `curation.priority`, `curation.note`

### `analysis/information.json`

정보 레퍼런스용 구조화 데이터입니다.

- 요약
- 메디컬뷰티 토픽
- 핵심 takeaway
- proof 포인트
- caution 포인트
- 기획용 hook 아이디어

### `analysis/format.json`

형식 레퍼런스용 구조화 데이터입니다.

- hook formula
- opening device
- delivery style
- scene flow
- subtitle / editing rhythm
- CTA pattern
- reusable / avoid rules

### `plans/<plan_id>/plan.json`

정보 + 형식 조합으로 만든 기획안입니다.

- title / topic / summary
- hook / coreMessage
- scenes
- captionDraft
- reviewChecklist
- sourceBreakdown

## 기존 기능과의 관계

기존에 있던 `discovery`, `harvest`, `publish`, `schedule` 관련 코드가 일부 repo 안에 남아 있을 수는 있지만, 현재 운영 구조의 중심은 아닙니다.

앞으로 새 작업은 아래 기준을 우선합니다.

- 수집은 사람이 직접 링크를 넣는다.
- 분류도 사람이 한다.
- 지표도 사람이 직접 입력한다.
- 시스템은 처리, 구조화, 기획 생성에 집중한다.

## 컴플라이언스

접근 권한이 있는 콘텐츠만 처리하세요. Instagram 이용약관과 관련 법규를 준수해야 합니다.

- 로그인은 사용자가 직접 수행합니다.
- 시스템은 사용자가 저장한 URL만 처리합니다.
- 브라우저 확장 프로그램이나 private API 호출에 의존하지 않습니다.

## 현재 한계

- Instagram DOM / 로그인 동선은 언제든 바뀔 수 있습니다.
- 미디어 다운로드는 로그인된 브라우저 세션에서 직접 노출되는 URL에만 의존합니다.
- 메디컬뷰티 정보는 반드시 사람 검수를 거쳐야 합니다.
- 기획안은 초안 생성 도구이고 최종 게시 전 사실 검수와 표현 검토가 필요합니다.
