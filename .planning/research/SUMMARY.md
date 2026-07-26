# Project Research Summary

**Project:** blindtest_2000 (open, unlimited-players, Kahoot-style music blindtest)
**Domain:** Real-time multiplayer web app with server-side YouTube audio extraction pipeline
**Researched:** 2026-07-26
**Confidence:** MEDIUM-HIGH

## Executive Summary

This is a room-based, real-time multiplayer party game in the Kahoot/Jackbox tradition, specialized around music: hosts author quizzes by pasting YouTube URLs + timestamps (auto-extracted into 30s clips), then run a live game where players join via QR/code on their phones, answer host-authored MCQ questions, and get scored on speed + accuracy. Every implementation found in the wild (open-source Kahoot clones, engineering write-ups) converges on the same shape: a Node/Socket.IO real-time gateway using WebSocket "rooms" as the tenant-isolation unit, a stateless HTTP API for auth/CRUD, and a completely decoupled async media pipeline (yt-dlp + ffmpeg run as a background worker, never during a live round). Audio itself never crosses the network to players: the host's browser plays the clip locally through room speakers, and the realtime layer only ever moves small JSON control messages. This single boundary decision eliminates an entire class of hard problems (audio sync, WebRTC, streaming bandwidth) that a naive reading of "real-time music game" would otherwise imply.

The recommended approach is: Fastify (or Express) + Socket.IO + PostgreSQL + Drizzle for the core service, better-auth for host accounts, and a Docker-packaged worker process running yt-dlp-exec/execa + system ffmpeg for extraction, writing finished clips to an S3-compatible bucket (Cloudflare R2 preferred for egress cost). Start single-instance with in-memory room state; only add Redis + the Socket.IO Redis adapter once real usage demands horizontal scaling — premature infra investment is explicitly flagged across all four research files as the top scope-creep risk for this kind of project.

The two biggest risks are not features but reliability and trust boundaries: (1) YouTube extraction is an inherently unstable third-party dependency (bot-detection on datacenter IPs, frequent yt-dlp breakage) — the project's own "extract at authoring time + manual upload fallback" decision is the correct mitigation and must be treated as first-class, not an edge case; and (2) the entire scoring/fairness model collapses if any client-reported time or unvalidated room/question ID is trusted — server-authoritative timestamps and room-membership validation must be baked into the game loop from round one, not retrofitted. Reconnect handling, idle-room cleanup, and cross-device audio-autoplay testing round out the "looks done but isn't" list that PITFALLS.md flags as commonly skipped in first builds of this exact genre.

## Key Findings

### Recommended Stack

Node.js 24 + TypeScript 7 + Fastify 5 (HTTP API) + Socket.IO 4.8 (realtime) + PostgreSQL + Drizzle ORM form the recommended backbone — versions verified directly against the npm registry (HIGH confidence). Socket.IO is chosen over raw ws specifically because its built-in rooms map 1:1 onto game sessions and its reconnection/broadcast primitives avoid hand-rolling exactly the logic this app needs. better-auth handles host accounts (Lucia is explicitly deprecated; avoid). For extraction, yt-dlp (system binary, wrapped by yt-dlp-exec) + system ffmpeg invoked via execa is the only viable combination — fluent-ffmpeg and ffmpeg-kit are both archived/dead as of 2025 and must not be used. Object storage should be R2/S3-compatible with presigned uploads; Redis + @socket.io/redis-adapter is a day-two addition, not a day-one requirement.

**Core technologies:**
- Socket.IO 4.8.x — realtime host↔player sync via room-scoped broadcast, built-in reconnection
- Fastify 5.x (or Express 5.x) — HTTP API for auth, quiz/question CRUD, upload URLs
- PostgreSQL + Drizzle ORM 0.45.x — relational store for hosts/quizzes/questions/games/scores
- yt-dlp (system binary) + execa + system ffmpeg — extraction pipeline, packaged via Docker
- better-auth 1.6.x — host account auth
- Cloudflare R2 (S3-compatible) — clip storage with zero egress fees

### Expected Features

The MVP feature set is almost identical to PROJECT.md's stated scope — research validated it rather than expanding it. The one architecturally load-bearing insight: "unlimited players" is a feature promise that depends entirely on room-scoped (not global) broadcast and non-O(n) leaderboard payloads, so it must be an architecture decision from phase 1, not a later optimization.

**Must have (table stakes):**
- Room join via code + QR (both simultaneously, not QR-only)
- No-account player join (nickname only) + nickname profanity filter
- One-tap MCQ answer buttons, immediate right/wrong feedback, between-round leaderboard
- Server-authoritative speed+accuracy scoring, host-paced manual round advance
- Reconnect-with-score (persistent player identity, not socket identity)

**Should have (differentiators):**
- YouTube URL + timestamp auto-extraction (no mainstream competitor does this)
- Clip preview/re-test at authoring time (prevents live-game surprises)
- Manual file-upload fallback, auto-suggested on extraction failure
- No player caps, no freemium tiers; host accounts with saved quiz library

**Defer (v2+):**
- Streaming-service playlist import (Spotify/Deezer) — adds licensing/API surface
- Buzzer/oral answer mode, progressive-reveal solo mode — different interaction models entirely
- Auto-generated decoy answers, monetization/paid tiers

### Architecture Approach

The system splits into four independently-testable layers: (1) two thin SPAs — host (big-screen, authoring, local audio playback) and player (mobile, join + answer only); (2) a combined HTTP API + WebSocket gateway process (no need to split into microservices at this scale); (3) an async media pipeline (job queue → yt-dlp/ffmpeg worker → object storage) fully decoupled from the live game loop, coupled only via a clipUrl/clipStatus field; (4) Postgres for durable state plus in-memory (later Redis) for ephemeral per-room game state. The realtime game-loop skeleton and the media pipeline can be built and tested in parallel with no blocking dependency between them.

**Major components:**
1. Realtime gateway (Socket.IO) — authoritative per-room state machine, phase transitions, server-timestamped scoring
2. HTTP API — auth, quiz/question CRUD, room creation, presigned upload URLs
3. Media worker — async yt-dlp/ffmpeg extraction, decoupled from game loop, writes clipUrl/clipStatus
4. Data stores — Postgres (durable), in-memory/Redis (ephemeral room state), object storage + CDN (clips)

### Critical Pitfalls

1. **Treating YouTube extraction as stable** — datacenter IPs get bot-walled, yt-dlp breaks on YouTube updates; mitigate with the already-planned manual-upload fallback treated as first-class, plus version pinning and monitoring.
2. **Trusting client-reported time/IDs for scoring** — server must stamp round-start and answer-receipt itself, and validate the submitted questionId/room membership; never trust the client.
3. **No reconnect/rejoin strategy** — mobile Wi-Fi drops and screen-locks are the normal case; requires persistent player-id (not socket-id) and server-pushed state resync on reconnect.
4. **Multi-tenant room state leaks / no cleanup** — build an idle-room reaper and strict room-membership validation from the same phase that introduces multi-room support, not later.
5. **Over-engineering realtime infra before validating the core loop** — ship a single-process, in-memory vertical slice end-to-end before considering Redis/horizontal scaling.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Data model, auth, quiz/question authoring (stubbed clips)
**Rationale:** Nothing else can exist without host accounts and a quiz/question schema; extraction can be stubbed (clipStatus: pending) so this phase has no dependency on the fragile media pipeline.
**Delivers:** Host signup/login, quiz/question CRUD (question, answer, decoys), DB schema.
**Addresses:** Host account + saved quiz library, host-authored answer+decoys (FEATURES.md P1 items).
**Avoids:** Over-engineering pitfall — no realtime or extraction infra touched yet.

### Phase 2: Room/realtime game-loop skeleton with placeholder clips
**Rationale:** This is the highest-risk, most novel part of the system (per ARCHITECTURE.md's suggested build order) and can be fully validated without real audio.
**Delivers:** Room creation with QR/join code, player join (nickname + moderation filter), host-driven round advance, server-authoritative answer submission/scoring, leaderboard broadcast, reconnect-with-score.
**Uses:** Socket.IO rooms, server-timestamped scoring pattern.
**Implements:** Realtime gateway component; room-as-isolation-unit pattern.
**Avoids:** Client-clock scoring pitfall, late-answer race conditions, no-reconnect pitfall, room-leak pitfall (build the idle-room reaper here, not later).

### Phase 3: Media pipeline — yt-dlp/ffmpeg extraction + manual upload fallback
**Rationale:** Independently buildable/testable against a CLI harness; concentrates the project's single biggest reliability risk in one isolated, iterable phase.
**Delivers:** Background extraction worker, job queue, object storage integration, clip-status tracking, manual-upload fallback UI trigger, clip preview/re-test at authoring time.
**Addresses:** YouTube URL + timestamp auto-extraction, pre-flight preview, manual fallback (FEATURES.md P1 differentiators).
**Avoids:** Pitfall 1 (fragile extraction) — fallback ships in the same phase, not deferred; also addresses storage retention/copyright exposure (Pitfall 7) with a basic deletion path.

### Phase 4: Wire real clips into the game loop + host playback
**Rationale:** Only once both prior slices work independently does it make sense to connect them; audio-playback specifics (autoplay unlock, precise clip start/stop) are best validated once real clips exist.
**Delivers:** Host-side clip pre-fetch/cache at lobby entry, real clipUrl wired into round-start events, host "tap to enable sound" gesture, cross-device audio testing (iOS Safari, Android Chrome, desktop).
**Avoids:** Pitfall 5 (autoplay/audio-precision failures) — explicit acceptance criterion, not a post-launch discovery.

### Phase 5: Polish and hardening
**Rationale:** Address remaining "looks done but isn't" items and P2 features once the core vertical slice has been played end-to-end with real users.
**Delivers:** Host kick-player control, large-room leaderboard payload shaping (top-N + own rank, not full O(n) broadcasts), quiz reuse UX polish, additional host controls.
**Avoids:** Premature scaling — Redis/horizontal-scaling infra explicitly deferred until real usage data demands it.

### Phase Ordering Rationale

- Phases 1-3 are ordered by dependency-criticality and risk isolation: auth/data model is a hard prerequisite for everything; the realtime loop and the media pipeline are mutually independent (per ARCHITECTURE.md) and could be parallelized by two contributors, but are sequenced here to keep a single-threaded roadmap simple — realtime first because it's the more novel/foundational risk to this team.
- Grouping matches the architecture's natural seams: clipUrl/clipStatus is the only coupling point between the game loop and the media pipeline, so keeping them in separate phases mirrors the codebase's own module boundaries (api/realtime/ vs media-worker/).
- Reconnect handling, server-authoritative timing, and room cleanup are placed in Phase 2 (not a later "hardening" phase) precisely because PITFALLS.md flags these as expensive to retrofit once shipped without them.
- Horizontal scaling (Redis adapter, multi-instance) is deliberately excluded from all named phases above and pushed to "when real usage demands it," per the explicit over-engineering pitfall.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3 (media pipeline):** yt-dlp bot-detection workarounds and cookie/proxy strategies change frequently (LOW-confidence, fast-moving area) — worth a research-phase pass close to implementation time to check current yt-dlp guidance.
- **Phase 4 (host playback):** Cross-browser audio autoplay/seek-precision behavior is device/OS-version-sensitive; validate against current iOS Safari/Android Chrome behavior at implementation time.

Phases with standard patterns (skip research-phase):
- **Phase 1 (auth/CRUD):** Well-documented, standard patterns (better-auth + Drizzle + Postgres CRUD).
- **Phase 2 (realtime skeleton):** Convergent, well-documented pattern across multiple open-source Kahoot clones (room-per-game-code + Socket.IO); server-authoritative timing is a known, simple pattern.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Package versions verified directly against npm registry (HIGH); ecosystem/architecture recommendations cross-verified across multiple 2025/2026 sources (MEDIUM); yt-dlp bot-detection specifics are LOW and fast-changing |
| Features | MEDIUM | Kahoot/Jackbox mechanics verified against official support docs; blindtest-specific and open-source-clone findings are LOW/single-source |
| Architecture | MEDIUM | No single authoritative reference architecture exists for this product category; synthesized from convergent evidence across multiple independent open-source implementations and official AWS/Ably docs for specific sub-patterns |
| Pitfalls | MEDIUM | General web search baseline is LOW per project classification, but cross-checked across multiple independent sources (GitHub issues, HN, engineering blogs); legal/copyright claims are informational only, not legal advice |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- yt-dlp/YouTube bot-detection workarounds shift frequently — re-verify current best practice (cookies, player_client args, proxy needs) immediately before starting Phase 3, not from this document alone.
- Legal/copyright posture of self-extracting and storing YouTube-sourced clips (2026 DMCA anti-circumvention ruling referenced in PITFALLS.md) is informational, not legal advice — the project owner should make an explicit, documented risk-acceptance decision before opening signups broadly.
- Exact "no player cap" ceiling (realistic max players per room before leaderboard-payload/broadcast design needs to change) has no hard number in research — validate empirically once Phase 2 is testable, using the top-N + own-rank payload shape from the start to defer the problem.
- Frontend framework choice (React vs Svelte vs SolidJS) was left open in STACK.md with React as the default recommendation — confirm during Phase 1/2 planning based on team preference and bundle-size sensitivity for venue-wifi conditions.

## Sources

### Primary (HIGH confidence)
- npm registry direct queries — package versions for the full recommended stack

### Secondary (MEDIUM confidence)
- Kahoot official support docs (join/PIN/scoring/nicknames/reconnection behavior)
- Jackbox official blog/how-to-play docs (room codes, host-paced play, kick-player feature)
- AWS official docs on presigned URLs; Ably engineering content on Socket.IO scaling and multiplayer quiz architecture
- Multiple independent open-source Kahoot-clone repositories (convergent room/Socket.IO/Express pattern)
- Web search cross-verification: fluent-ffmpeg/ffmpeg-kit archival, Lucia Auth deprecation, Drizzle vs Prisma, R2 vs S3 egress, Node LTS schedule

### Tertiary (LOW confidence)
- blindtest.gg and open-source blindtest-clone marketing/README pages — single-source, used only for competitive-landscape framing
- yt-dlp GitHub issues, Hacker News, and secondary news coverage of DMCA stream-ripping ruling — informational, needs spot-check at implementation time
- GameDev.net forum discussion on client/server clock drift — general domain knowledge, not project-specific

---
*Research completed: 2026-07-26*
*Ready for roadmap: yes*
