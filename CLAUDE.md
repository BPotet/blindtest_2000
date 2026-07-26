# CLAUDE.md

This file configures Claude Code's behavior and enforces the development workflow for this project.

---

## Development Methodology: OpenSpec (specs) + GSD (implementation loop)

This project separates **what to build** from **how it gets built**:

- **[OpenSpec](https://github.com/Fission-AI/OpenSpec)** owns the **specifications**. It is the single source of truth for requirements and behavior — every capability, scenario, and acceptance criterion lives in an OpenSpec change/spec, written before any code. OpenSpec replaces GSD's idea → spec authoring role.
- **[GSD](https://github.com/open-gsd/gsd-core)** owns the **implementation loop**. GSD plans, executes, and verifies the work — and it does so by reading the OpenSpec specs and validating the implementation against them. GSD is the engine; OpenSpec is the contract it builds and checks against.

### Workflow: spec first, then automatic implementation

```
OpenSpec spec  →  GSD plan → execute → verify (against the OpenSpec spec)  →  release
   (human)              (automatic — no human intervention)
```

1. **Specify with OpenSpec** — author or update the spec/change for the capability. This is the human-authored step: it defines the requirements and scenarios that everything downstream is validated against.
2. **Implement with GSD — automatic, no human intervention.** Once a spec exists, the GSD implementation loop runs autonomously: it plans the phase, executes tasks (one commit per task), and verifies. Do **not** insert manual checkpoints into this loop — it is meant to run unattended. Plans should be `autonomous: true`; avoid `checkpoint:human-verify` gates unless a step is genuinely impossible to automate (e.g. an OS keychain or GUI smoke test that has no headless equivalent).
3. **Verify against the spec** — GSD verification does not check "did the tasks run"; it checks the implementation against the OpenSpec spec. The OpenSpec spec is the acceptance contract: if the code doesn't satisfy the spec's scenarios, verification fails.

**Spec before implementation, always.** No GSD planning or execution without a corresponding OpenSpec spec to validate against.

### GSD Slash Commands (implementation loop)

| Command | When to use |
|---|---|
| `/gsd-new-project` | Bootstrap a brand-new milestone/roadmap from scratch (greenfield) |
| `/gsd-onboard` | Bring GSD onto an existing codebase |
| `/gsd-plan-phase N` | Break a phase (derived from an OpenSpec spec) into atomic, executable tasks |
| `/gsd-execute-phase N` | Run tasks automatically, one commit per task — no human checkpoints |
| `/gsd-verify-work N` | Validate that phase N satisfies its OpenSpec spec |
| `/gsd-ship` | Ship the phase — commit/push per the branch strategy above |
| `/gsd-complete-milestone` | Tag release, archive, initialize next cycle |

### Artifacts

OpenSpec owns the specs; GSD owns the planning/execution memory.

```
openspec/             # OpenSpec — source of truth for WHAT to build
├── specs/            # Current capability specs (the acceptance contract)
└── changes/          # Proposed/in-flight spec changes

.planning/            # GSD — implementation loop memory
├── PROJECT.md        # Project vision and context
├── ROADMAP.md        # Phase breakdown
├── STATE.md          # Current project memory (do not edit manually)
├── config.json       # Workflow preferences
└── phases/           # Per-phase plans, summaries, verification reports
```

The OpenSpec specs are the authority on requirements and behavior. GSD's `.planning/` artifacts track how that contract is being implemented. Always refer to both, never assume.

---

## Branch Strategy

```
main    → production AND development — commit and push directly here
```

**Rules:**

- Work directly on `main` — **no side branches, no PRs**
- Once the implementation is done and validated against the OpenSpec spec **and the test pyramid is green** (see below), push straight to `main` — do not open a pull request, do not wait to be asked
- **Test pyramid gate (required before pushing to `main`):**
  - **Many unit tests** — the broad base; every pure function and business rule
  - **Some integration tests** — the middle; key cross-module flows (e.g. YouTube fetch → clip extraction → storage pipeline)
  - **Few e2e tests** — the tip; only the genuinely beneficial end-to-end paths, nothing redundant
  - All of the above must pass (`npm test`, and `npm run test:e2e` where e2e exists) before the push
- Pushing to `main` triggers CI automatically — so a red test pyramid must never reach `main`

```bash
git checkout main && git pull origin main

# make changes, then:

git add -p && git commit -m "type(scope): message"
npm test                       # unit + integration — must be green
git push origin main            # direct push — no PR
```

---

## Commit Convention

Format: `type(scope): short imperative description`

```bash
feat(auth): add GitHub OAuth login
fix(nav): correct mobile menu z-index
chore(deps): upgrade vite to v6
docs(readme): add installation steps
test(api): add unit tests for /users endpoint
```

Types: `feat` · `fix` · `chore` · `docs` · `style` · `refactor` · `test` · `perf`

Always stage interactively:

```bash
git add -p                        # review every hunk before committing
git commit -m "type(scope): msg"
git push origin HEAD
```

During `/gsd:execute-phase`, GSD commits automatically — one commit per task. Do not batch tasks into a single commit.

---

## Shipping to main — no PRs

This project does **not** use pull requests. When the GSD implementation loop has finished and the work is validated against the OpenSpec spec, you push directly to `main`. The only gate is the test pyramid.

### Ship checklist (all required before `git push origin main`)

- [ ] Implementation satisfies its OpenSpec spec (`/gsd-verify-work N` passed)
- [ ] **Unit tests** green — the broad base, covering every pure function and business rule
- [ ] **Integration tests** green — key cross-module flows
- [ ] **E2E tests** green — only the beneficial end-to-end paths (`npm run test:e2e` where applicable)
- [ ] No leftover `console.log` / debug code
- [ ] Commits are atomic (one logical change each)

### The test pyramid (build it in this proportion)

```
        ▲   e2e          few — only genuinely beneficial paths
       ▲▲▲  integration  some — key cross-module flows
      ▲▲▲▲▲ unit         many — the broad, fast base
```

- Favor unit tests: they are fast, isolate logic, and catch the most regressions per line.
- Add integration tests for the seams where modules meet (YouTube extraction → trimming, upload → storage, gameplay scoring).
- Keep e2e minimal — each one is slow and brittle; write one only when it protects a path nothing below it can cover.

### Ship

```bash
git checkout main && git pull origin main
npm test                       # unit + integration — must be green
npm run test:e2e               # where e2e exists — must be green
git push origin main            # direct push, no PR — triggers CI
```

A red test pyramid must never reach `main`.

---

## Rules for Claude Code

### Always

- Read `CLAUDE.md` fully before starting any task
- Author/update the **OpenSpec spec first** — it is the acceptance contract GSD verifies against. No GSD planning or execution without a spec.
- Run the **GSD implementation loop automatically** — plan → execute → verify with no human checkpoints (`autonomous: true`). The loop is meant to run unattended.
- Work directly on `main` — no side branches
- Follow the GSD phase sequence — do not jump to execution without a plan
- Commit atomically — one logical change per commit
- Build and run the full **test pyramid** (many unit, some integration, few e2e) and confirm it is green **before** pushing to `main`
- Reference both the `openspec/` specs (what to build) and `.planning/` files (how it's built) for context; update `STATE.md` when GSD instructs

### Never

- Plan or execute with GSD without a corresponding OpenSpec spec to validate against
- Insert manual `checkpoint:human-verify` gates into the implementation loop unless a step is genuinely impossible to automate
- Open a pull request or create a side branch — push directly to `main`
- Push to `main` with a red or unrun test pyramid
- Use `--force` on a push — use `--force-with-lease`
- Install new dependencies without a clear justification
- Combine multiple unrelated changes in one commit

---

## Quick Reference

```bash

# 1. SPEC (human) — author/update the OpenSpec spec first

openspec list                       # see current specs/changes
openspec validate                   # spec is the acceptance contract

# 2. IMPLEMENT (automatic — GSD loop, no human intervention)

/gsd-plan-phase 1                   # derive tasks from the OpenSpec spec
/gsd-execute-phase 1                # run tasks unattended, one commit per task
/gsd-verify-work 1                  # validate implementation against the OpenSpec spec
/gsd-complete-milestone

# 3. SHIP (direct to main — no PR, gated on the test pyramid)

git checkout main && git pull origin main
git add -p && git commit -m "feat(scope): message"
npm test                            # unit + integration — must be green
npm run test:e2e                    # where e2e exists — must be green
git push origin main                # direct push — triggers CI
```

---

## Project Links

- **Repo**: `https://github.com/BPotet/blindtest_2000`
- **Actions**: `https://github.com/BPotet/blindtest_2000/actions`
- **OpenSpec docs** (specs — source of truth): `https://github.com/Fission-AI/OpenSpec`
- **GSD docs** (implementation loop): `https://github.com/open-gsd/gsd-core`

---

<!-- GSD:project-start source:PROJECT.md -->

## Project

**Blindtest 2000**

Blindtest 2000 est une application web façon Kahoot, dédiée aux blindtests musicaux : les joueurs rejoignent une partie en scannant un QR code depuis leur téléphone, et l'hôte lance chaque manche quand il le souhaite. Une manche fait jouer un extrait audio précis de 30 secondes — extrait automatiquement d'une vidéo YouTube (URL + timestamp de départ), ou uploadé manuellement si l'extraction échoue — et les joueurs répondent à un QCM sur mobile.

**Core Value:** Permettre à n'importe quel hôte de lancer un blindtest musical avec un nombre de joueurs illimité et ses propres extraits audio, sans les restrictions freemium de Kahoot (limite de joueurs, impossibilité d'importer de l'audio librement).

### Constraints

- **Fiabilité extraction**: L'extraction YouTube n'est pas garantie à 100% (vidéo privée, géo-restreinte, retirée, blocage anti-bot des IP de datacenter) — le fallback upload manuel est une exigence v1, pas une amélioration optionnelle.
- **Risque légal extraction**: Une décision de justice fédérale US (2026) a établi que les outils de type stream-ripping (yt-dlp) peuvent engager une responsabilité DMCA indépendamment du statut du contenu — risque accepté consciemment par l'auteur pour un usage à petite échelle, à réévaluer si le service grandit publiquement.
- **Multi-parties simultanées**: Le service devant accueillir plusieurs hôtes/parties en parallèle, l'architecture doit isoler l'état de chaque partie (pas d'hypothèse d'instance unique).
- **Pas de GitHub Pages seul**: GitHub Pages est un hébergement statique uniquement — incompatible avec le besoin d'un serveur Node.js persistant (Socket.IO temps réel, exécution de binaires ffmpeg/yt-dlp). Le frontend ET le backend sont hébergés ensemble sur Render.
- **Stockage audio hors plateforme d'hébergement**: Le disque d'un service Render n'est pas persistant entre redéploiements — les clips audio extraits/uploadés sont stockés sur Cloudflare R2, pas sur le serveur applicatif.
- **Tech stack**: Node.js + Socket.IO + PostgreSQL + yt-dlp/ffmpeg (binaires, pas de wrapper npm type fluent-ffmpeg, archivé) — détail complet dans `.planning/research/STACK.md`.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 24.x (Active LTS) | Runtime | Node 24 is Active LTS as of mid-2026 (Node 22 is Maintenance LTS through Apr 2027, Node 26 is Current but won't hit LTS until Oct 2026). Use 24 for a new production service — not bleeding-edge 26, not aging-out 22. **[MEDIUM]** |
| TypeScript | 7.x | Language | End-to-end type safety across a host-view/player-view/websocket-event surface with many message shapes (join, answer, score-update, round-start) — this is exactly the kind of app where a typo in an event payload shape causes silent runtime bugs. TS 7 (Corsa, native-compiled) is dramatically faster to typecheck than TS 5/6 on the same codebase. **[HIGH — npm registry confirms 7.0.2 is current]** |
| Socket.IO | 4.8.x (server: `socket.io`, client: `socket.io-client`) | Real-time host↔player sync | Built-in **rooms** map 1:1 onto game sessions (one room per game code); built-in **reconnection** handles players' phones losing wifi/screen-locking mid-round without you writing that logic; built-in **broadcast to room** (`io.to(roomId).emit(...)`) is exactly the "push clip-start/question/leaderboard to everyone in this game" primitive you need. Raw `ws` is faster per-message but you'd hand-roll rooms, reconnect, and presence — not worth it for this app's message volume (small payloads, moderate frequency). **[MEDIUM, cross-verified across multiple 2025/2026 sources]** |
| Fastify | 5.x | HTTP API server (host auth, quiz CRUD, clip upload, serving Socket.IO's HTTP layer) | Faster than Express (schema-based validation/serialization built in, first-class TypeScript types), and its plugin ecosystem includes an official WebSocket plugin if you ever need raw upgrades alongside Socket.IO's own HTTP server. Express remains fine and more universally documented if the team is more comfortable with it — see Alternatives. **[MEDIUM]** |
| PostgreSQL | 16/17 | Primary datastore (hosts, quizzes, questions, games, scores) | Standard relational choice for a multi-tenant service with clear relational structure (host → quiz → question → game → player → answer). Any managed Postgres (Neon, Supabase, Railway Postgres) works; avoid SQLite for the *hosted* multi-tenant deployment (fine only for local single-host mode, see Stack Patterns by Variant). **[MEDIUM]** |
| Drizzle ORM | 0.45.x | Database access layer | Thin, SQL-shaped, TypeScript-first — by early 2026 it has overtaken Prisma as the default pick in popular TS starter templates. Better fit than Prisma here because the schema is small/stable and you want full control over the score-calculation queries (leaderboard ranking, speed-based points) rather than fighting an abstraction. **[MEDIUM]** |
| Redis (`ioredis` client) + `@socket.io/redis-adapter` | ioredis 5.x / adapter 8.3.x | Cross-instance pub/sub for Socket.IO rooms | Only needed once you run more than one server process/instance. The adapter publishes room broadcasts to a Redis channel so all instances re-emit to their own locally-connected sockets — this is the standard, first-class way Socket.IO scales horizontally. Since "multiple simultaneous games" is a hard requirement, plan for this from day one even if you launch on a single instance (cheap to add now, painful to retrofit under load). **[MEDIUM]** |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `yt-dlp` (Python binary, not npm) | latest (self-updating) | YouTube audio/segment extraction engine | The actual extraction work. Must be installed as a system binary in your deployment image (Docker), not an npm dependency. Update frequently — YouTube changes trigger frequent yt-dlp point releases to fix breakage. |
| `yt-dlp-exec` | 1.0.2 | Node.js wrapper that shells out to the `yt-dlp` binary | Use this over `youtube-dl-exec` for new code — it defaults to invoking `yt-dlp` (actively maintained daily) rather than the largely-abandoned `youtube-dl`. `youtube-dl-exec` (3.1.9) is still published and can be pointed at a yt-dlp binary via config, so either works, but `yt-dlp-exec` is less error-prone by default. **[MEDIUM]** |
| `ffmpeg` (system binary) | 6.x/7.x via static build | Audio trimming/transcoding/normalization | Do **not** wrap it with `fluent-ffmpeg` — see What NOT to Use. Call it directly. |
| `execa` | 10.x | Spawning `yt-dlp`/`ffmpeg` child processes | Promise-based `child_process` wrapper with much better error surfacing (stderr capture, exit code handling, timeouts) than raw `child_process.spawn`. This is the 2025/2026 default replacement pattern now that `fluent-ffmpeg` and `ffmpeg-kit` are both archived. |
| `qrcode` | 1.5.x | Generate the room-join QR code | The de facto standard (1M+ weekly downloads); outputs PNG/SVG/data-URL directly from the join URL (e.g. `https://yourapp/join/ABC123`). Generate server-side when creating the room, or client-side in the host view — either works since it's a pure function of the join URL. |
| `nanoid` | 6.x | Short human-typeable room codes | Pair the QR code with a short code (e.g. 6 uppercase alphanumeric chars) players can type manually if scanning fails (bad lighting, no camera access) — a Kahoot-standard fallback. Use a custom alphabet excluding ambiguous characters (0/O, 1/I/l). |
| `multer` | 2.2.x | Manual audio upload fallback (multipart/form-data) | Server-side handling of the "extraction failed → host uploads a file" path. For a small service, uploading through your Fastify/Express server to local disk or directly forwarding to object storage is simpler than presigned-URL direct-to-S3 flows — see Stack Patterns by Variant for when to switch. |
| Cloudflare R2 (or S3-compatible bucket) | — | Object storage for extracted/uploaded audio clips | Clips need to be served repeatably to the host's screen during a live game and are 30-second audio files — small, but with real egress volume if the service gets any traction. R2 has zero egress fees vs S3's $0.09/GB out, which matters specifically here because you're *streaming audio to clients* repeatedly, not just archiving. S3-API-compatible, so swapping later is low-risk. **[MEDIUM]** |
| `better-auth` | 1.6.x | Host account auth (signup/login/session) | Purpose-built for exactly this scale: small service, not enterprise SSO. TypeScript-first, framework-agnostic (works with Fastify/Express), owns its own session/cookie handling so you don't need a separate session store initially. Fastest-growing auth library through 2025 into 2026 — see Alternatives for why not Lucia or Auth.js. **[MEDIUM]** |
| `zod` | 4.x | Runtime validation | Validate Socket.IO event payloads and HTTP request bodies (quiz creation, YouTube URL + timestamp input, answer submissions) — critical here because player-submitted websocket messages are untrusted input from arbitrary phones. |
| `vite` | 8.x (via chosen frontend framework's scaffold) | Frontend build tool | Standard fast dev server + bundler for both the host SPA and the player SPA; used regardless of React/Svelte/Solid choice below. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Docker | Packaging `yt-dlp` + `ffmpeg` + Node runtime together | The extraction pipeline is the one part of this stack that is *not* npm-installable (Python binary + native ffmpeg build) — a Dockerfile is the only reliable way to guarantee both binaries exist and are pinned to known-working versions in every environment (dev, CI, prod). Treat this as non-optional, not a nice-to-have. |
| pnpm workspaces (or a lightweight monorepo) | Managing host app / player app / server / shared types as one repo | You have two frontends (host big-screen view, player mobile view) sharing the same backend and the same websocket event *types* — a shared `types` package keeps the Socket.IO event contract in sync across all three without copy-pasting interfaces. |
| ESLint + Prettier | Linting/formatting | Standard; no domain-specific reasoning needed here. |

## Installation

# Server core

# Frontend (per app: host/ and player/)

# Dev dependencies

# yt-dlp (Python) + ffmpeg must be present as OS binaries

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| Socket.IO | raw `ws` + hand-rolled rooms | Only if you outgrow Socket.IO's overhead at very high concurrency (thousands of sockets per process) — unlikely for a blindtest app where one room = one physical room of people. |
| Socket.IO | uWebSockets.js | Only relevant at 10k+ concurrent connections per instance; wrong tool for this app's scale. |
| Fastify | Express 5.x | Fine, arguably the safer choice if the team already knows Express deeply — Express 5 (major rewrite, released 2025) fixed most of the long-standing async error-handling pain points. Express has a much bigger plugin/StackOverflow corpus, which matters for a solo/small team debugging under time pressure. |
| Drizzle ORM | Prisma 7 | If you want a more "opinionated/guided" ORM experience and don't mind the extra abstraction layer — Prisma 7 (Nov 2025) cut its historically huge bundle size dramatically (Rust engine → TS/WASM), closing much of the gap with Drizzle. Reasonable pick if the team already has Prisma experience. |
| React or Svelte (see Stack Patterns) | SolidJS | If the team wants maximum runtime performance for the host's live-updating leaderboard/timer view and is comfortable with a smaller ecosystem/community than React or Svelte. |
| `better-auth` | Auth.js (NextAuth) | If you specifically want easy "Sign in with Google/Discord" social login with minimal config (80+ providers out of the box) and don't mind that Auth.js is now in "security-only" maintenance mode rather than active feature development. |
| `better-auth` | Roll your own (bcrypt + JWT/sessions) | Only if the auth surface is truly trivial (single shared password, no per-host accounts) — but the project requires real host accounts, so use a library. |
| Cloudflare R2 | Plain local disk storage | Acceptable only for the self-hosted/single-instance variant (see Stack Patterns) — breaks immediately once you run more than one server instance or want durability across redeploys. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `fluent-ffmpeg` | GitHub repo **archived May 22, 2025**; the maintainer stopped supporting it and it no longer works correctly against recent ffmpeg builds. Building new 2026 code on it means building on a dead dependency on day one. **[MEDIUM, cross-verified]** | `execa` + direct `ffmpeg` CLI argv construction |
| `ffmpeg-kit` / `ffmpeg-kit-react-native` | Also archived (May 2025); binaries were pulled from Maven Central/CocoaPods/npm in April 2025 — literally stopped being installable. | System `ffmpeg` binary via `execa`/`child_process` |
| `youtube-dl` (the original, non-yt-dlp project) | Effectively unmaintained compared to `yt-dlp`; breaks against current YouTube far more often and far longer before fixes ship. | `yt-dlp` binary (via `yt-dlp-exec`) |
| Lucia Auth | The project **explicitly deprecated itself** — the npm package says so. Building new auth on it in 2026 means adopting an unmaintained core dependency for your most security-sensitive subsystem. | `better-auth` |
| Extracting audio live/on-demand during a running game | Not just a "what not to use" library issue — architecturally, live extraction ties round-start latency to YouTube/yt-dlp reliability at the worst possible moment (mid-party, in front of players). This is already correctly called out as an anti-pattern in the project's own constraints. | Extract-and-validate at quiz creation time, serve pre-extracted files during the game (already the project's decision) |
| Assuming YouTube extraction "just works" in production without cookie/bot-detection handling | YouTube's bot detection ("Sign in to confirm you're not a bot") increasingly blocks unauthenticated `yt-dlp` requests from datacenter IPs (which is exactly what a hosted server is) — this is a load-bearing pitfall for a hosted service, not a hobbyist edge case. **[MEDIUM — cross-verified, but exact trigger conditions change frequently; treat as LOW-confidence detail]** | Budget for `--extractor-args "youtube:player_client=android"` and/or a cookies strategy from day one; treat the manual-upload fallback as a first-class, frequently-used path, not a rare edge case — see PITFALLS.md |
| SQLite for the multi-tenant hosted deployment | Fine for local dev or the single-host self-hosted variant, but a genuinely multi-tenant "many hosts, many concurrent games" service benefits from Postgres's concurrent-write handling and the option to run multiple app instances against one shared database. | PostgreSQL (managed: Neon/Supabase/Railway) |

## Stack Patterns by Variant

- Skip Redis/`@socket.io/redis-adapter` initially — Socket.IO's in-memory adapter is sufficient for one process.
- Use local disk for uploaded/extracted clips behind the app server, or the cheapest R2/S3 bucket if you want redeploy-safe storage without much extra work.
- Because: matches the "small open service" framing in PROJECT.md — no need to pay complexity for scale you don't have yet, but choosing Postgres + Socket.IO + R2 from the start means growing into multi-instance later is a config change, not a rewrite.
- Add `ioredis` + `@socket.io/redis-adapter` so room broadcasts reach players regardless of which instance they're connected to.
- Move uploads to presigned-URL direct-to-R2/S3 uploads (browser → bucket) instead of routing large files through your app server via `multer`, since multiple instances behind a load balancer make "upload through the server" more awkward to reason about.
- Because: this is the textbook Socket.IO horizontal-scaling pattern; doing it only when needed avoids premature complexity.
- **Recommended: React 19.x** for both the host (big-screen) and player (mobile) views, sharing the `socket.io-client` event-handling logic in a shared package.
- Because: this app is two thin, event-driven UIs (host: current clip/timer/leaderboard; player: current question/answer buttons/score) — not a DOM-manipulation-heavy or animation-heavy app where Svelte/Solid's raw performance edge matters. React's ecosystem size (component libraries, Socket.IO integration examples, hiring/community support if this grows beyond a solo project) outweighs the framework-benchmark differences here.
- **Choose Svelte 5 instead if:** the team already prefers Svelte's DX and smaller bundle sizes matter because players are joining over potentially weak venue wifi/cellular — Svelte 5's compiled output is meaningfully smaller than a React bundle, which is a real, relevant consideration for a "join on your phone at a party" use case. **[MEDIUM]**
- **Choose SolidJS instead if:** the team wants React-like syntax with near-native reactivity performance and is comfortable with a smaller community/fewer examples to lean on when things go wrong under time pressure.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `socket.io@4.8.x` | `socket.io-client@4.8.x` | Keep server/client major+minor versions in lockstep; mismatches between major versions can break the handshake. |
| `@socket.io/redis-adapter@8.3.x` | `socket.io@4.x` + `ioredis@5.x` | The adapter version tracks Socket.IO's major version, not the other way around — check the adapter's own compatibility table before bumping Socket.IO majors. |
| `drizzle-orm@0.45.x` | `pg@8.22.x`, `drizzle-kit@0.45.x` (matching minor) | Keep `drizzle-kit` (migrations CLI) in sync with `drizzle-orm`'s minor version to avoid schema-diff drift. |
| `yt-dlp-exec@1.0.2` | system `yt-dlp` binary, any recent version | The npm package is a thin exec wrapper; correctness depends on the installed `yt-dlp` binary version, not the npm package version — pin/update the binary in your Dockerfile, not just the npm dependency. |
| `better-auth@1.6.x` | Fastify or Express via its framework adapters | Confirm the specific Fastify adapter/plugin version matches the Fastify major (5.x) you're on. |

## Sources

- npm registry (`registry.npmjs.org`) direct queries — version numbers for `socket.io`, `ws`, `@socket.io/redis-adapter`, `qrcode`, `fastify`, `express`, `drizzle-orm`, `better-auth`, `yt-dlp-exec`, `youtube-dl-exec`, `multer`, `execa`, `zod`, `vite`, `react`, `svelte`, `solid-js`, `typescript`, `ioredis`, `pg`, `nanoid` — **[HIGH]**, fetched 2026-07-26
- Web search (cross-verified across multiple independent 2025/2026 articles): Socket.IO vs ws vs uWebSockets.js comparisons — **[MEDIUM]**
- Web search: yt-dlp `--download-sections` + ffmpeg trim semantics — **[MEDIUM]**
- Web search: YouTube ToS / yt-dlp legality discussions (multiple independent sources agree on the ToS-prohibition / civil-not-criminal framing) — **[MEDIUM]**
- Web search: `fluent-ffmpeg`/`ffmpeg-kit` archival dates (May 2025 / April 2025), corroborated by GitHub repo archive status referenced in search results — **[MEDIUM]**
- Web search: Node.js LTS schedule (Node 24 Active LTS, Node 26 Current, single-release-per-year change starting Node 27) — **[MEDIUM]**
- Web search: YouTube bot-detection / cookie-requirement reports for yt-dlp — **[LOW-MEDIUM]**, exact trigger conditions and workarounds shift frequently and reports are less consistent than other findings; treat as a pitfall to monitor, not a fixed recipe
- Web search: Fastify vs Express performance/WebSocket-support comparisons — **[MEDIUM]**
- Web search: Drizzle vs Prisma 2026 comparisons — **[MEDIUM]**
- Web search: R2 vs S3 egress pricing — **[MEDIUM]**
- Web search: Lucia Auth deprecation, Better Auth growth trajectory, Auth.js maintenance-mode status — **[MEDIUM]**

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

| Skill | Description | Path |
|-------|-------------|------|
| openspec-apply-change | Implement tasks from an OpenSpec change. Use when the user wants to start implementing, continue implementation, or work through tasks. | `.claude/skills/openspec-apply-change/SKILL.md` |
| openspec-archive-change | Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete. | `.claude/skills/openspec-archive-change/SKILL.md` |
| openspec-explore | Enter explore mode - a thinking partner for exploring ideas, investigating problems, and clarifying requirements. Use when the user wants to think through something before or during a change. | `.claude/skills/openspec-explore/SKILL.md` |
| openspec-propose | Propose a new change with all artifacts generated in one step. Use when the user wants to quickly describe what they want to build and get a complete proposal with design, specs, and tasks ready for implementation. | `.claude/skills/openspec-propose/SKILL.md` |
| openspec-sync-specs | Sync delta specs from a change to main specs. Use when the user wants to update main specs with changes from a delta spec, without archiving the change. | `.claude/skills/openspec-sync-specs/SKILL.md` |
| openspec-update-change | Update an OpenSpec change by revising its existing planning artifacts and keeping them coherent with one another. Use when the user wants to revise a change's plan, fold new decisions into it, or reconcile its artifacts after an edit. Never edits code. | `.claude/skills/openspec-update-change/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
