# Walking Skeleton — Blindtest 2000

**Phase:** 1
**Generated:** 2026-07-27
**Source of truth:** `openspec/changes/phase-1-host-quiz-authoring/design.md` (technical), `.planning/research/STACK.md` (versions), `01-UI-SPEC.md` (visual contract)

## Capability Proven End-to-End

> A visitor can create a host account from the React app running on `localhost`, have that account persisted in Postgres through Drizzle, receive a session cookie issued by better-auth, and land on their (empty) quiz list — with `pnpm dev` as the single command that brings the whole stack up.

This is the Phase-1 special case of the tracer: it is delivered by `01-01-PLAN.md` Task 1 (`type="tracer"`) and completed by Task 2 (login / logout / session persistence / route guard). Every later slice in this phase and in Phases 2–3 is built on the architectural decisions recorded below without altering them.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Package manager / repo shape | pnpm workspaces monorepo: `apps/server`, `apps/web`, `packages/shared` | `design.md` "Monorepo layout"; STACK.md anticipates host app + player app + server sharing a typed event/API contract. Starting the workspace shape now avoids a restructure in Phase 2 when the player app lands. |
| Runtime | Node.js 24.x (Active LTS), TypeScript 7.x, ESM | STACK.md core table. Not Node 22 (aging out), not Node 26 (not LTS until Oct 2026). |
| HTTP server | Fastify 5.x | STACK.md core table. Schema-based validation/serialization, first-class TS types, and it will host Socket.IO's HTTP layer in Phase 2 without a rewrite. |
| Data layer | PostgreSQL 16/17 + Drizzle ORM 0.45.x + `pg` 8.22.x, migrations via `drizzle-kit` 0.45.x checked into `apps/server/drizzle/` | STACK.md + `design.md`. Postgres (not SQLite) from day one so Phase 2/3 room/game/player tables need no data-layer rework. Local Postgres runs from `docker-compose.yml`; the app itself runs with `pnpm dev`, **not** in Docker (no deployment this phase). |
| Auth | `better-auth` 1.6.x, email+password provider, session cookie, session/account tables in the same Postgres database, Drizzle adapter | STACK.md ("Lucia deprecated itself; roll-your-own rejected because real host accounts are required") + `design.md`. Password hashing, session issuance, and cookie attributes are delegated to the library — never hand-rolled. |
| Host identity table | better-auth's own `user` table **is** the host account | `design.md` task 2.2 names a `hosts` table; with better-auth the account/identity table is generated and owned by the library. A parallel `hosts` table would duplicate identity and split the FK target. `quizzes.host_id` references `user.id`. **Surfaced deviation from `design.md` wording — same capability, no scope change.** |
| Frontend | React 19.x + Vite 8.x, CSS Modules, `lucide-react` icons, no component library | STACK.md "Stack Patterns by Variant" (React for host + player) + `01-UI-SPEC.md` Design System table (tool: none, CSS Modules, `lucide-react`, system font stack). |
| Client routing | `react-router-dom` 7.x | Not pinned by any source artifact. The host app has ≥5 real routes (`/signup`, `/login`, `/quizzes`, `/quizzes/:id`, `/quizzes/:quizId/questions/:questionId`). **Surfaced planner decision** — reversible, isolated to `apps/web/src/App.tsx` and page files. |
| Dev API wiring | Vite dev-server proxy `/api` → `http://localhost:3000` | Makes browser→API requests same-origin in dev, so the better-auth session cookie is a first-party cookie with no CORS-credentials footguns. |
| Test runner | Vitest 3.x (workspace-wide), `app.inject()` for server route tests, real Postgres test database for repository/integration tests | Not pinned by any source artifact; Vitest is the standard runner for a Vite/TS workspace. **Surfaced planner decision.** CLAUDE.md's test pyramid (many unit / some integration / few e2e) governs proportions. |
| Media pipeline | `yt-dlp` + `ffmpeg` **system binaries** spawned via `execa` 10.x (`yt-dlp-exec` 1.0.2 wrapper for yt-dlp) — never `fluent-ffmpeg`/`ffmpeg-kit` | STACK.md "What NOT to Use" (both archived 2025) + `design.md` extraction pipeline. Binaries are a documented developer prerequisite this phase (no Docker image exists yet). |
| Multipart upload handling | `@fastify/multipart` | STACK.md names `multer` 2.2.x; multer is Express-only middleware and does not run on the Fastify 5 server STACK.md also mandates. `@fastify/multipart` is the official Fastify-org plugin providing the same multipart/form-data capability. **Surfaced technical-compatibility correction, not a scope change.** |
| Clip storage | Local disk `apps/server/data/clips/<question-id>.mp3`, behind a `saveClip()` / `getClipUrl()` seam in `apps/server/src/media/storage.ts` | `design.md` + STACK.md "Stack Patterns by Variant" (local disk sanctioned for the single-instance/local variant). The seam is the explicit reversibility mitigation: the later Cloudflare R2 migration re-implements those two functions without touching callers. |
| Clip access control | Clip bytes are served only through an ownership-scoped route (`GET /api/questions/:id/clip`, authenticated host must own the parent quiz) — never a public static directory | PITFALLS.md Security Mistakes: "Storing/serving extracted clips at broadly accessible public URLs" increases bandwidth cost and copyright-takedown exposure. |
| Language | All user-facing copy in French, pinned verbatim by `01-UI-SPEC.md` "Copywriting Contract" | Matches PROJECT.md / ROADMAP.md / REQUIREMENTS.md / openspec. |

## Stack Touched in Phase 1

- [ ] Project scaffold — pnpm workspace, TypeScript, Vite, Vitest, lint scripts, `pnpm dev` running server + web together (`01-01` T1)
- [ ] Routing — real server routes (`/api/health`, `/api/auth/*`) and real client routes (`/signup`, `/login`, `/quizzes`) (`01-01` T1/T2)
- [ ] Database — real write (`user` + `session` rows created on signup) and real read (`SELECT 1` health probe; quiz list query) (`01-01` T1, `01-02` T1)
- [ ] UI — interactive signup form wired to the API, landing on the authenticated shell (`01-01` T1)
- [ ] Local full-stack run command — `docker compose up -d` then `pnpm dev`, documented in the root `README.md` (`01-01` T1, `01-05` T3)

## Out of Scope (Deferred to Later Slices)

Explicit, so future phases do not re-litigate Phase 1's minimalism:

- **No deployment, no Dockerfile for the app, no CI pipeline for the app image** — `docker-compose.yml` exists only to run local Postgres (`design.md` Non-Goals).
- **No Cloudflare R2 / object storage** — local disk behind the `saveClip()`/`getClipUrl()` seam.
- **No Redis, no Socket.IO, no websockets, no rooms, no QR codes, no join codes, no players** — Phase 2.
- **No gameplay, no scoring, no leaderboard, no reconnection** — Phase 3.
- **No OAuth / social login, no email verification, no password reset** — email+password only; no email provider is configured in a local-only phase.
- **No quiz library/reuse polish (QUIZ-05), no decoy suggestion assistant (QUIZ-06), no playlist import (QUIZ-07)** — v2 per REQUIREMENTS.md.
- **No player-facing UI of any kind** — no player exists until Phase 2 (`01-UI-SPEC.md` Scope).
- **No clip retention/cleanup policy enforcement** — PITFALLS.md Pitfall 7 requires an owner-deletion path (delivered: delete quiz cascades, delete question removes its clip) but not an automated retention job.

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering the architectural decisions above:

- **Phase 2 — Salle de jeu & arrivée des joueurs:** adds `apps/player` (or player routes), Socket.IO on the existing Fastify HTTP server, `rooms`/`players` tables against the same Drizzle schema, QR + join code. Reuses: workspace shape, `packages/shared` contract types, Postgres/Drizzle, better-auth host session for room ownership.
- **Phase 3 — Déroulé de partie, scoring & fiabilité:** adds the server-authoritative round state machine, `answers`/`scores` tables, host playback of the already-`ready` clips produced by this phase. Reuses: `getClipUrl()` seam, `questions.clip_status`/`clip_path`, the ownership-scoped clip route.
- **Hosting milestone (post-v1):** swaps `saveClip()`/`getClipUrl()` to Cloudflare R2, adds the Dockerfile pinning `yt-dlp`/`ffmpeg`, adds Redis + `@socket.io/redis-adapter`. Touches the storage module and deployment config only.
