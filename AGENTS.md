# AGENTS.md

## Project intent

이 프로젝트의 현재 운영 구조는 `자동 탐색 파이프라인`이 아니라 `사람이 큐레이션한 레퍼런스 워크스페이스`다.

핵심 흐름:

1. 사람이 `정보 릴스` 링크를 저장한다.
2. 사람이 `형식 릴스` 링크를 저장한다.
3. 시스템이 다운로드 / 오디오 추출 / 전사 / 구조화 분석을 수행한다.
4. 사람이 선별한 정보 + 형식 레퍼런스로 기획안을 만든다.

지표는 자동 수집보다 `manualMetrics` 입력을 우선한다.

## Primary commands

- `npm run dev`: 로컬 웹앱 실행
- `npm run app` / `npm start`: `npm run dev` 별칭
- `npm run login`: Instagram 세션 저장
- `npm run run`: 미처리 레퍼런스 처리
- `npm run analyze`: 미분석 레퍼런스 분석
- `npm run generate -- --info <id> --format <id>`: 기획안 생성

기본 로컬 주소: `http://127.0.0.1:3030`

## Current app surface

웹앱에서 가능한 작업:

- 레퍼런스 생성 / 수정 / 삭제
- 정보 / 형식 분리 관리
- 수동 지표 입력
- 처리 큐 실행
- 분석 큐 실행
- 기획안 생성 / 수정 / 삭제

백엔드 큐는 메모리 기반이다. 서버 재시작 시 큐 히스토리는 사라져도, 실제 산출물은 파일시스템에 남는다.

## Source of truth

파일시스템이 DB 역할을 한다.

### Reference bundle

경로: `data/reels/<reel_id>/`

- `record.json`: 사람이 관리하는 메타데이터
- `meta.json`, `source.json`, `manifest.json`: 처리 파이프라인 산출물
- `transcript/transcript.txt`
- `analysis/information.json`
- `analysis/format.json`
- `analysis/structure.json`
- `analysis/portability.json`

### Plan bundle

경로: `data/plans/<plan_id>/`

- `plan.json`
- `plan.md`

## Files to read first in a new session

1. [README.md](C:/dev/instagram-reels-pipeline/README.md)
2. [AGENTS.md](C:/dev/instagram-reels-pipeline/AGENTS.md)
3. [src/workspace/references.js](C:/dev/instagram-reels-pipeline/src/workspace/references.js)
4. [src/workspace/process.js](C:/dev/instagram-reels-pipeline/src/workspace/process.js)
5. [src/workspace/analyze.js](C:/dev/instagram-reels-pipeline/src/workspace/analyze.js)
6. [src/planning/generate.js](C:/dev/instagram-reels-pipeline/src/planning/generate.js)
7. [src/app/server.js](C:/dev/instagram-reels-pipeline/src/app/server.js)
8. [src/app/public/app.js](C:/dev/instagram-reels-pipeline/src/app/public/app.js)

## Important invariants

- 새 기능은 `정보/형식 분리` 모델을 우선해야 한다.
- 자동 탐색 기능은 주 흐름으로 되돌리지 않는다.
- `record.json`의 사람이 입력한 메타데이터를 덮어쓰지 않는다.
- 레퍼런스 삭제는 해당 `data/reels/<reel_id>/` 전체를 지운다.
- 기획안은 사실 생성기가 아니라 `레퍼런스 기반 초안 생성기`다.
- 메디컬/시술 관련 표현은 항상 사람이 최종 검수해야 한다.

## Legacy note

`src/discovery`, 기존 `generation`, `publish`, `schedule` 코드는 repo 안에 남아 있을 수 있다.

현재 작업의 우선순위는 다음과 같다:

- `src/workspace/*`
- `src/reference/focused.js`
- `src/planning/generate.js`
- `src/app/*`

레거시 모듈은 읽기 전용 참고 대상으로 보고, 새 작업은 새 워크스페이스 구조에 맞춰 확장한다.
