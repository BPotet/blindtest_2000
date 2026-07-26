## 1. Repo & workspace setup

- [ ] 1.1 Initialize pnpm workspace (`pnpm-workspace.yaml`) with `apps/server`, `apps/web`, `packages/shared`
- [ ] 1.2 Scaffold `apps/server` (Fastify + TypeScript) with base `package.json`, `tsconfig.json`
- [ ] 1.3 Scaffold `apps/web` (React 19 + Vite + TypeScript)
- [ ] 1.4 Scaffold `packages/shared` for shared TS types (API request/response shapes)
- [ ] 1.5 Add root `docker-compose.yml` with a local Postgres service for dev
- [ ] 1.6 Add `.gitignore` entries for `apps/server/data/` (local clip storage) and env files
- [ ] 1.7 Add a startup check in the server verifying `yt-dlp` and `ffmpeg` are on `PATH`, failing fast with a clear message if missing

## 2. Database layer

- [ ] 2.1 Add Drizzle ORM + `pg` to `apps/server`; configure `drizzle.config.ts`
- [ ] 2.2 Define schema: `hosts`, `quizzes`, `questions` tables (question includes `clip_status`, `clip_source`, `clip_path`, `correct_answer`, `decoys`)
- [ ] 2.3 Generate and run initial migration against local Postgres
- [ ] 2.4 Write unit tests for schema helper/query functions (e.g. quiz/question repository functions) using a test database or transaction rollback

## 3. Host auth (host-auth capability)

- [ ] 3.1 Integrate `better-auth` (email/password provider) with Fastify adapter and Drizzle/Postgres session storage
- [ ] 3.2 Implement signup endpoint + duplicate-email rejection
- [ ] 3.3 Implement login endpoint + wrong-password rejection
- [ ] 3.4 Implement session persistence (cookie) and logout endpoint
- [ ] 3.5 Add auth guard middleware for host-only routes
- [ ] 3.6 Unit tests: signup success/duplicate, login success/failure, logout invalidates session
- [ ] 3.7 Frontend: signup page, login page, logged-in redirect/guard for host routes

## 4. Clip extraction pipeline

- [ ] 4.1 Implement `extractClip(youtubeUrl, startSeconds)` using `yt-dlp-exec` + `execa` with `--download-sections` for a 30s window
- [ ] 4.2 Implement `ffmpeg` normalization step (via `execa`) producing a consistent audio format at `apps/server/data/clips/<question-id>.mp3`
- [ ] 4.3 Implement failure detection (non-zero exit, timeout, empty output) setting `clip_status = 'failed'` with the raw error logged
- [ ] 4.4 Implement `saveClip()` / `getClipUrl()` storage-access module (local disk now, swappable for R2 later without touching callers)
- [ ] 4.5 Implement static/streaming route to serve a question's clip for preview/playback
- [ ] 4.6 Unit tests: extraction success path (mock `execa`/binaries), extraction failure path sets `clip_status = 'failed'`
- [ ] 4.7 Integration test: real `yt-dlp`+`ffmpeg` invocation against a short, stable public test video (or a documented skip if binaries unavailable in CI)

## 5. Quiz & question authoring (quiz-authoring capability)

- [ ] 5.1 Implement quiz CRUD endpoints (create, list-by-host) scoped to the authenticated host
- [ ] 5.2 Implement "add question from YouTube URL + timestamp" endpoint, wiring to the extraction pipeline (task 4)
- [ ] 5.3 Implement re-cut endpoint (new timestamp for existing question re-runs extraction, replaces prior clip)
- [ ] 5.4 Implement manual upload fallback endpoint (`multer`, local disk) — only meaningful when `clip_status = 'failed'`
- [ ] 5.5 Implement answer + decoys save endpoint with validation (reject incomplete questions per spec)
- [ ] 5.6 Unit tests: quiz creation, question creation happy/failure paths, re-cut replaces clip, upload fallback sets ready+source=upload, incomplete-question rejection
- [ ] 5.7 Integration test: full authoring flow — create quiz → add question via YouTube → (simulate failure) → upload fallback → save answer+decoys → question appears complete in quiz

## 6. Frontend host views

- [ ] 6.1 Quiz list page (create quiz, navigate to quiz detail)
- [ ] 6.2 Question editor: YouTube URL + timestamp form, extraction status display, inline audio preview player, re-cut control
- [ ] 6.3 Upload fallback form shown when a question's clip status is failed
- [ ] 6.4 Answer + decoys form per question, with validation feedback matching backend rejection reasons
- [ ] 6.5 Wire frontend to `packages/shared` types for all API calls

## 7. Wrap-up

- [ ] 7.1 Add root `README.md` (or update) with local setup steps: install `yt-dlp`/`ffmpeg`, `docker compose up` for Postgres, `pnpm install`, `pnpm dev`
- [ ] 7.2 Run full test suite (unit + integration) and confirm green
- [ ] 7.3 Manually verify end-to-end locally: signup → login → create quiz → add question with a real YouTube link → preview clip → save answer/decoys
