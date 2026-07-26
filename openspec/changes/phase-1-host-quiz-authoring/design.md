## Context

Greenfield repo — no application code exists yet. This is the first vertical slice (Phase 1 of `.planning/ROADMAP.md`). `.planning/research/STACK.md` already picked the target stack for the whole project (Node/Fastify, PostgreSQL/Drizzle, Socket.IO, Redis, R2, better-auth, yt-dlp+ffmpeg via execa). This design scopes that stack down to what Phase 1 actually needs to run **locally only**: no Socket.IO/Redis (no rooms/gameplay yet — that's Phase 2/3), no R2 (local disk is fine for dev and is explicitly sanctioned by STACK.md for the single-instance/local variant).

Everything chosen here must still be the right long-term choice (Postgres, not SQLite; Drizzle; better-auth) so Phase 2/3 build on top without a rewrite — only the *scope* is cut down, not the *stack*.

## Goals / Non-Goals

**Goals:**
- A host can sign up, log in, and stay logged in (cookie session) — running entirely on `localhost`.
- A host can create a quiz and add a question from a YouTube URL + start timestamp, with a real 30s clip extracted on disk.
- A host can preview the clip and re-cut the timestamp before saving.
- A host sees a clear fallback upload form when extraction fails, and that fallback actually attaches a working clip to the question.
- A host can enter the correct answer + decoys per question.
- Everything is verifiable with `npm run dev` (or equivalent) on a fresh machine that has Node, `yt-dlp`, and `ffmpeg` installed, plus a local Postgres.

**Non-Goals:**
- No rooms, QR codes, websockets, or live gameplay (Phase 2/3).
- No deployment, no Docker image, no Cloudflare R2, no Redis — those are hosting-phase concerns explicitly deferred by the user.
- No OAuth/social login — email+password only, via `better-auth`'s built-in email/password provider.
- No quiz library/reuse polish, no nickname anything (no players exist yet in Phase 1).

## Decisions

**Monorepo layout (pnpm workspaces):**
```
apps/
  server/   # Fastify API: auth, quiz/question CRUD, extraction pipeline, uploads
  web/      # React host app (Vite): login, quiz list, question editor
packages/
  shared/   # Shared TypeScript types for API request/response shapes
```
Rationale: STACK.md already anticipates a host app + player app + server sharing event/type contracts; starting the workspace shape now avoids a restructure in Phase 2 when the player app is added.

**Backend: Fastify + Drizzle + PostgreSQL + better-auth.**
Matches STACK.md exactly. Postgres (not SQLite) from day one — Phase 1 is local-only, but the schema and query patterns must not need rework when Phase 2/3 add rooms/games/players. Local Postgres runs via `docker-compose.yml` (Postgres container only — the app itself runs with `npm run dev`, not in Docker, since there's no deployment yet).

**Extraction pipeline: `yt-dlp-exec` + `execa` + system `ffmpeg`, no `fluent-ffmpeg`.**
Matches STACK.md's explicit "what not to use" (fluent-ffmpeg/ffmpeg-kit are archived/dead). Flow per question:
1. Host submits YouTube URL + start timestamp (seconds) + quiz/question form.
2. Server runs `yt-dlp` with `--download-sections "*START-END"` (START = timestamp, END = timestamp+30) to fetch only the needed audio segment, extracting to a temp file.
3. Server runs `ffmpeg` (via `execa`) to normalize the segment to a fixed format (e.g. `.mp3` or `.m4a`, consistent sample rate) at `apps/server/data/clips/<question-id>.mp3`.
4. On success: question row gets `clip_status = 'ready'`, `clip_source = 'youtube'`, `clip_path` set.
5. On any failure (non-zero exit, timeout, empty output): question row gets `clip_status = 'failed'`; API returns a structured error the frontend uses to show the upload-fallback form for that question.
6. Manual upload (`multer`, local disk, same `data/clips/` directory) writes the same `clip_path`/`clip_status='ready'`/`clip_source='upload'` fields — the schema doesn't care which path produced a ready clip, matching the ARCHITECTURE.md research recommendation.

**Clip storage: local disk under `apps/server/data/clips/`, served by a static Fastify route for preview/playback.**
Acceptable per STACK.md's "Stack Patterns by Variant" for local/single-instance use; swapping to R2 later is a config change in the storage-access module, not a data-model change — the module exposes `saveClip()`/`getClipUrl()` functions that Phase 2/3 (and the later hosting migration) can re-implement against R2 without touching callers. `data/clips/` and `data/*.sqlite`-style local artifacts are gitignored.

**Auth: `better-auth` email/password provider, Fastify adapter, session cookie.**
No email verification/password reset in Phase 1 (no email provider configured yet — out of scope for a local-only phase); sessions persist via better-auth's own cookie/session store backed by the same Postgres database.

**Frontend: React 19 + Vite, host-only views for this phase.**
Login/signup, quiz list, quiz detail/question editor with an inline audio player for clip preview and a re-cut control (re-submit a new timestamp for the same question), and the upload-fallback form. Talks to the Fastify API over plain HTTP (no websockets needed until Phase 2).

## Risks / Trade-offs

- **yt-dlp bot-detection / breakage** → Mitigation: treat extraction failure as an expected, first-class path (already required by QUIZ-03), not an edge case; log the raw `yt-dlp` stderr for debugging but never block the host — always offer upload fallback immediately.
- **Local `yt-dlp`/`ffmpeg` not installed on dev machine** → Mitigation: a startup check in the server that verifies both binaries are on `PATH` and fails fast with a clear setup error instead of a confusing extraction failure later.
- **Postgres required locally (heavier than SQLite for a solo dev loop)** → Mitigation: ship a `docker-compose.yml` that starts Postgres with one command; documented in the phase's README/setup notes. Trade-off accepted to avoid a Phase 2/3 data-layer rewrite.
- **Local disk clip storage won't survive the later move to hosting** → Mitigation: isolate storage access behind `saveClip()`/`getClipUrl()` so the R2 migration (already decided in PROJECT.md for the hosting phase) only touches one module.

## Migration Plan

N/A — first code in the repo, nothing to migrate from. Local Postgres schema is created via Drizzle migrations (`drizzle-kit generate` + `drizzle-kit migrate`), checked into `apps/server/drizzle/`.

## Open Questions

- Exact clip audio format/bitrate (e.g. `mp3` @ 128kbps vs `m4a`) — default to `mp3` for universal browser `<audio>` support; revisit only if quality complaints arise.
- Whether `yt-dlp` should be vendored/pinned via a setup script vs. documented as a manual prerequisite for Phase 1 — defaulting to "documented prerequisite" since there's no Docker image yet in a local-only phase.
