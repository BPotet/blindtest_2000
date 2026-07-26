## Why

Blindtest 2000 needs a host-facing way to build a music quiz before any game can be run. Today there is no code at all — hosts have no account, and there is no way to turn a YouTube link into a playable 30-second clip. This is Phase 1 of the project roadmap (`.planning/ROADMAP.md`): the vertical slice that makes quiz creation real end-to-end (real YouTube extraction, real fallback upload, real QCM authoring), before rooms (Phase 2) or live gameplay (Phase 3) can be built on top of it.

## What Changes

- Host can create an account (email/password) and log back in later; session persists.
- Host can create a quiz and add questions by pasting a YouTube URL + start timestamp; the backend extracts a precise 30-second audio clip via `yt-dlp` + `ffmpeg` (spawned as binaries, not an npm wrapper).
- Host can preview/listen to the extracted clip and re-cut the timestamp before saving the question, catching bad cuts before game night.
- If extraction fails (private/region-locked/removed video, `yt-dlp` error), the app detects the failure and shows a manual audio file upload form as a replacement for that question's clip.
- For each question, host manually enters the correct answer plus one or more decoys to form the multiple-choice options.
- Scope for this change: runs and is fully testable **locally only** (no deployment, no Cloudflare R2 — clips are stored on local disk in dev).

## Capabilities

### New Capabilities

- `host-auth`: Host account creation, login, and session persistence.
- `quiz-authoring`: Quiz and question creation, including YouTube-to-clip extraction, clip preview/re-cut, manual upload fallback on extraction failure, and answer/decoy entry for each question.

### Modified Capabilities

(none — greenfield project, no existing specs)

## Impact

- New backend service (Node.js) with a database (PostgreSQL) for host accounts, quizzes, and questions.
- New dependency on system binaries `yt-dlp` and `ffmpeg`, invoked via `execa` (no `fluent-ffmpeg`/`ffmpeg-kit`, both dead per `.planning/research/STACK.md`).
- New local filesystem storage for extracted/uploaded audio clips in dev (object storage is a hosting-phase concern, out of scope here).
- New frontend host-facing views: login/signup, quiz list, question editor with clip preview player and upload fallback form.
- No impact yet on room/gameplay code — those don't exist until Phase 2/3.
