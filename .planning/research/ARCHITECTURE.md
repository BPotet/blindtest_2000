# Architecture Research

**Domain:** Real-time, room-based multiplayer quiz game (Kahoot-style music blindtest)
**Researched:** 2026-07-26
**Confidence:** MEDIUM (cross-checked web sources + convergent evidence from multiple open-source Kahoot clones; no single official "reference architecture" exists for this exact product category, so this is a synthesis, not a citation of one authoritative source)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CLIENTS                                   │
│  ┌──────────────────────┐        ┌──────────────────────────────┐   │
│  │  Host Client (big     │        │  Player Client (mobile web,  │   │
│  │  screen / laptop)     │        │  no install)                 │   │
│  │  - quiz builder UI    │        │  - join via QR / code        │   │
│  │  - room control panel │        │  - nickname entry             │   │
│  │  - plays audio LOCALLY│        │  - MCQ answer UI              │   │
│  │  - shows leaderboard  │        │  - own leaderboard rank        │   │
│  └──────────┬────────────┘        └───────────────┬───────────────┘   │
│             │  REST (auth, quiz CRUD, uploads)     │  REST (join)     │
│             │  WebSocket (game events)             │  WebSocket       │
├─────────────┴───────────────────────────────────────┴─────────────────┤
│                          BACKEND API + REALTIME LAYER                 │
│  ┌───────────────────────────┐   ┌────────────────────────────────┐  │
│  │  HTTP API (auth, quiz/     │   │  WebSocket gateway (Socket.io   │  │
│  │  question CRUD, room       │   │  or equivalent) — one "room"    │  │
│  │  creation, upload URLs)    │   │  per game, event fan-out        │  │
│  └──────────────┬─────────────┘   └───────────────┬────────────────┘  │
│                 │                                  │                    │
│                 │        shared room/game state    │                    │
│                 └───────────────┬──────────────────┘                    │
├─────────────────────────────────┴───────────────────────────────────┤
│                     MEDIA PIPELINE (async, offline of gameplay)      │
│  ┌────────────────┐   ┌──────────────────┐   ┌─────────────────┐    │
│  │ Extraction job  │→  │ yt-dlp + ffmpeg   │→  │ Object storage   │    │
│  │ queue (per      │   │ worker process    │   │ (S3-compatible)  │    │
│  │ question)       │   │ (download+trim)   │   │ + CDN in front   │    │
│  └────────────────┘   └──────────────────┘   └─────────────────┘    │
│                    ↑ manual-upload fallback joins here                │
├───────────────────────────────────────────────────────────────────────┤
│                             DATA STORES                                │
│  ┌────────────────┐   ┌───────────────────┐   ┌───────────────────┐  │
│  │ Relational DB   │   │ In-memory / Redis  │   │ Object storage     │  │
│  │ (hosts, quizzes,│   │ (live room state:  │   │ (audio clip files)  │  │
│  │ questions,      │   │ current question,  │   │                     │  │
│  │ rooms, answers) │   │ connected players)  │   │                     │  │
│  └────────────────┘   └───────────────────┘   └───────────────────┘  │
└───────────────────────────────────────────────────────────────────────┘
```

**The single most important boundary decision for this product:** audio never streams over the realtime layer. The clip is a file the host's own browser plays locally through the host's speakers. The WebSocket layer only ever transmits small JSON control messages (`play this question now`, `player X answered`, `here's the leaderboard`). This eliminates an entire class of hard problems (audio sync across devices, WebRTC, buffering) that a naive reading of "real-time music game" might suggest you need. Players never need to receive audio at all — they only see a question and options on their own screen.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Host client | Quiz authoring UI, room control (start/next round), plays the audio clip locally, renders live leaderboard, shows QR/join code | SPA (React/Vue), `<audio>` element, QR code generated client- or server-side from join code |
| Player client | Join by scanning QR/entering code, nickname, answers MCQ, sees own result + rank | Mobile-first SPA or lightweight server-rendered page, no install required |
| Backend HTTP API | Auth (host accounts), quiz/question CRUD, room creation, generates upload URLs, serves clip metadata | REST/JSON API (Node.js/Express/Fastify or similar), stateless |
| Realtime sync layer | Authoritative game-state machine per room; broadcasts phase transitions; receives and validates answers; computes server-side timing | WebSocket server (Socket.io or `ws`), one logical "room" = one game instance |
| Media pipeline | Turns a YouTube URL + timestamp into a stored 30s audio file at quiz-creation time; falls back to accepting a manually uploaded file | Background worker process running yt-dlp + ffmpeg, triggered by a job queue |
| Object storage + CDN | Durable storage for finished audio clips, served to the host client with low latency | S3-compatible bucket (AWS S3, Cloudflare R2, MinIO for self-host) + CDN/edge cache |
| Relational DB | Source of truth for hosts, quizzes, questions, room history, players, answers | Postgres (or SQLite for very small self-hosted deployments) |
| Ephemeral game state | Fast-changing per-room state: who's connected, current question index, in-flight answers before scoring | In-process memory (single instance) or Redis (once horizontally scaled) |

## Recommended Project Structure

```
apps/
├── host-web/           # Host-facing SPA: quiz builder, room control, audio playback
├── player-web/         # Player-facing mobile SPA: join, answer, leaderboard
├── api/                # HTTP API: auth, quiz/question CRUD, room creation, upload URLs
│   ├── routes/
│   ├── db/             # migrations, models/schema
│   └── realtime/       # WebSocket gateway, room/game state machine, event handlers
└── media-worker/       # Background worker: consumes extraction jobs, runs yt-dlp+ffmpeg,
                         # uploads result to object storage, updates question status
packages/
├── shared-types/       # Socket event payloads, DB entity types shared across apps
└── shared-ui/          # (optional) shared components between host-web and player-web
```

### Structure Rationale

- **`api/realtime/` lives inside the API app, not a separate service:** for this project's scale (small open multi-tenant service, not thousands of concurrent rooms), splitting the WebSocket gateway into its own microservice adds operational complexity (service discovery, cross-service auth) with no payoff. Keep HTTP and WebSocket in one process; split only if/when connection count or deploy cadence forces it.
- **`media-worker/` is a separate deployable process from day one**, even while small: `yt-dlp` invocations are slow (seconds to tens of seconds), depend on an unreliable third party (YouTube), and must never block an HTTP request thread or a game round. Isolating it also means it can be restarted/scaled independently and its failure mode (extraction fails) is contained.
- **`shared-types/` is what keeps host/player/api/worker in sync** on the shape of WebSocket events and question/room entities — without it, a field rename on the server silently breaks a client at runtime, which is a common source of bugs in Socket.io projects.

## Architectural Patterns

### Pattern 1: Room as the isolation unit

**What:** Every game instance is a "room" — a WebSocket room (e.g. Socket.io `room`) keyed by a short join code, plus a corresponding row in the DB. All server-side state relevant to one game (current question, connected players, scores) is scoped to that room key. Nothing is ever broadcast globally.
**When to use:** Any time multiple independent, simultaneous game instances share one backend process. This is universal in every Kahoot-style implementation found (see Sources).
**Trade-offs:** Simple and battle-tested; the main risk is forgetting to scope a query/broadcast by room and leaking one game's events into another — mitigate by always deriving the target room from server-side session/socket state, never trusting a room id supplied by the client for anything other than "which room do you want to join."

**Example:**
```typescript
// server: broadcast only to sockets that joined this room
io.to(room.joinCode).emit("question:start", {
  questionId: question.id,
  options: question.options,
  clipUrl: question.clipUrl,
  startedAt: serverNow, // server-authoritative timestamp
});
```

### Pattern 2: Server-authoritative timing for scoring

**What:** The server records the timestamp when it broadcasts `question:start`. When a player's answer arrives, elapsed time is computed as `serverReceivedAt - question.startedAt`, never from a timestamp the client sends. Score = f(correctness, elapsed time).
**When to use:** Any competitive quiz with speed-based scoring (i.e., this project). Client clocks are unreliable and client-reported timing is trivially spoofable.
**Trade-offs:** Slightly more state to track per room (per-question start time), but this is the only approach that is both fair and cheat-resistant. Network latency variance between players is an accepted, unavoidable fairness limitation of this pattern (same limitation Kahoot itself has).

**Example:**
```typescript
socket.on("answer:submit", ({ questionId, choiceId }) => {
  const room = getRoom(socket.roomId);
  if (room.currentQuestionId !== questionId || room.locked) return; // stale/late
  const elapsedMs = Date.now() - room.currentQuestionStartedAt;
  recordAnswer(room, socket.playerId, choiceId, elapsedMs);
});
```

### Pattern 3: Async media pipeline decoupled from the game loop

**What:** YouTube extraction happens as a background job when a host adds/edits a question — never during a live round. The question row has a `clipStatus` (`pending` | `ready` | `failed`) that the host UI polls or receives via a status event; on `failed`, the UI surfaces the manual upload fallback automatically.
**When to use:** Any pipeline step that is slow, third-party-dependent, or unreliable. Directly matches this project's explicit requirement ("extraction happens at quiz creation, never live").
**Trade-offs:** Adds a job queue and a "pending" UX state to the quiz builder, but this is a small cost for removing all extraction risk from the live game — which is the single biggest reliability win available in this architecture.

## Data Flow

### "Host starts round N" propagation

```
Host clicks "Next question"
    ↓ (WebSocket event: room:advance, host-authenticated socket)
Realtime gateway
    ↓ validate: sender is this room's host, room is in a state that allows advancing
Room state machine: currentQuestionIndex++, currentQuestionStartedAt = now, locked = false
    ↓ persist lightweight room state (memory or Redis)
    ↓ broadcast to room (io.to(joinCode).emit)
┌────────────────────────────┬─────────────────────────────┐
│ Host client                │ All connected player clients │
│ receives question:start    │ receive question:start        │
│ → plays clip locally from  │ → renders MCQ options,        │
│   pre-fetched clip URL      │   starts local answer timer   │
└────────────────────────────┴─────────────────────────────┘
```

### Player answer → scoring

```
Player taps an option
    ↓ (WebSocket event: answer:submit {questionId, choiceId})
Realtime gateway
    ↓ validate: question still active for this room, player hasn't already answered
    ↓ compute elapsedMs = serverNow - room.currentQuestionStartedAt (server-authoritative)
    ↓ compute correctness + points (speed + accuracy formula)
    ↓ persist Answer row (room, player, question, choice, elapsedMs, correct, points)
    ↓ ack back to the answering player only (their result)
Host advances / round window ends
    ↓ aggregate all Answer rows for the room+question
    ↓ update cumulative Player scores
    ↓ broadcast leaderboard:update to the whole room
```

Two key properties: (1) the server is the single source of truth for "who answered what, when" — clients never compute their own score; (2) rounds only end when the host explicitly advances (per the "host controls pace" requirement), so there is no server-side timer forcing a round to close — the server just stops accepting answers for the closed question once the host advances.

### Key Data Flows

1. **Quiz authoring flow:** Host client → HTTP API (create question with YouTube URL + timestamp) → API enqueues extraction job → media worker processes async → worker updates question row + uploads clip to object storage → host client polls/subscribes for `clipStatus` → on `failed`, host client requests an upload URL from the API and uploads the file directly to object storage, then notifies the API to mark the question `ready`.
2. **Room lifecycle flow:** Host client → HTTP API (create room from a quiz) → API returns join code + generates QR payload → players hit a join endpoint or connect a socket directly with the code → realtime gateway adds each player's socket to the room → host advances rounds via WebSocket events as described above → on room end, final leaderboard is persisted and room is closed (removed from active in-memory state; historical rows remain in the DB).

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| A handful of simultaneous rooms, tens of players each (realistic v1 usage) | Single Node process, in-memory room state, single Postgres instance. No Redis needed. This comfortably fits the "small open service" framing in PROJECT.md. |
| Many simultaneous rooms and/or need to run more than one server process (uptime, deploys) | Move ephemeral room state to Redis; add the Socket.io Redis adapter for cross-instance pub/sub; use sticky sessions at the load balancer so a given client stays on one instance. |
| One room with a very large number of players (a "no cap" requirement could produce an outlier large room) | Avoid broadcasting the *full* leaderboard to every player on every update — send each player their own rank + score plus a top-N slice; full leaderboard payloads scale O(n) per broadcast and become the actual bottleneck before connection count does. |

### Scaling Priorities

1. **First likely bottleneck:** clip delivery latency to the host at the moment "next question" is clicked, if clips are fetched on demand. Mitigate by having the host client **pre-fetch/cache all clip URLs for the whole quiz when the room enters the lobby**, so mid-game playback is instant regardless of object storage/CDN latency.
2. **Second likely bottleneck:** leaderboard broadcast payload size in an unusually large single room (see table above). Not a concern for the typical few-dozen-player game night use case, but worth designing the payload shape to avoid it early since "no player cap" is an explicit requirement.

## Anti-Patterns

### Anti-Pattern 1: Extracting audio live, on-demand, during a round

**What people do:** Trigger the YouTube download/trim when the host clicks "play" during the game, to save pre-processing time.
**Why it's wrong:** yt-dlp extraction is slow and depends on a third party that can fail unpredictably (geo-restriction, video pulled, rate limiting). A failure mid-game, in front of players, is exactly the failure mode this project's requirements explicitly rule out.
**Do this instead:** Extract at quiz-creation time only (already decided in PROJECT.md); the game loop only ever reads an already-`ready` clip URL.

### Anti-Pattern 2: Trusting client-reported answer time or client-reported room/question id without validation

**What people do:** Let the player's browser report "I answered in 1.2s" or accept an answer for whatever `questionId` the client sends.
**Why it's wrong:** Trivially spoofable — any player can fake an instant, always-correct answer, defeating the entire speed+accuracy scoring premise.
**Do this instead:** Server timestamps `question:start` server-side and computes elapsed time from its own receipt time of the answer event; server also validates the submitted `questionId` matches the room's actual current question before accepting.

### Anti-Pattern 3: Streaming audio to players over the realtime layer

**What people do:** Assume a "music game" needs to pipe audio to every connected device (WebRTC broadcast, server-side audio relay, etc.).
**Why it's wrong:** Massively overengineered for this product — players don't need to hear the clip on their own device, only the host does (host's screen/speakers, per the explicit requirement). Adding audio streaming introduces sync-across-devices problems, bandwidth costs, and WebRTC complexity for zero product value here.
**Do this instead:** Player clients never touch audio. Host client plays the file locally via a normal `<audio>` element; the realtime layer only sends the small "play this question now" signal.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| YouTube (via yt-dlp) | Background worker shells out to the yt-dlp binary as a child process, not an inline HTTP call | Subject to YouTube ToS/API changes; the manual upload fallback exists specifically to absorb this instability — this is a domain pitfall worth deeper research in its own right (see PITFALLS.md), not just an integration detail |
| Object storage (S3-compatible) | Presigned URLs: client (or worker) uploads directly to the bucket, backend never proxies the file bytes | Standard, well-documented AWS pattern; keep upload URL expiry short (15-60 min) |
| CDN in front of storage | Point clip URLs at a CDN/edge cache in front of the bucket rather than the bucket directly | Reduces latency for the pre-fetch-at-lobby-time pattern above |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Host/Player clients ↔ Realtime gateway | WebSocket (room-scoped events) | Only place "live game" state changes flow; keep the event vocabulary small and versioned in `shared-types` |
| Host/Player clients ↔ HTTP API | REST/JSON | Auth, quiz/question CRUD, room creation, join, upload-URL issuance — anything not time-critical |
| API ↔ Media worker | Job queue (DB-backed job table or a lightweight queue like BullMQ over Redis) | Decouples request latency from extraction latency; worker writes results back by updating the question row, API/host client observes the status change |
| Media worker ↔ Object storage | Direct SDK/API calls after successful extraction | Worker is the only writer of `clipUrl` on success; manual-upload path writes the same field via a different code path but the same schema field, so the game loop never needs to know which path produced a ready clip |

## Suggested Build Order

The realtime game-loop skeleton and the media pipeline are **independently buildable** — this is the most important build-order implication for the roadmap. Their only coupling point is the `clipUrl`/`clipStatus` field on a Question; everything else on each side can be developed and tested in isolation (the game loop against placeholder/silent clips, the pipeline against a CLI harness with no game involved).

1. **Data model + auth + quiz/question CRUD.** Nothing else can exist without a host account and a quiz/question schema. Question can be built with a stubbed `clipUrl`/`clipStatus: 'pending'` at this stage — no extraction logic required yet.
2. **Room/join/WebSocket skeleton with placeholder clips.** Build room creation, QR/join-code flow, player join, host-driven round advancement, answer submission, server-authoritative scoring, and leaderboard broadcast — using a hardcoded or silent placeholder clip. This proves out the entire "how does host action N propagate to all players in that room" loop, which is the highest-risk, most novel-to-this-team part of the system, without waiting on the media pipeline.
3. **Media pipeline: yt-dlp/ffmpeg background worker + object storage + manual upload fallback.** Build and test this end-to-end against the job queue and storage, independent of the game loop (a CLI/test harness can invoke it directly). This is where the reliability risk explicitly called out in PROJECT.md concentrates, so it deserves focused, isolated iteration.
4. **Wire real clips into the game loop.** Point the room/question flow at real `clipUrl` values produced by step 3; add the host-side pre-fetch/cache-at-lobby-time behavior.
5. **Polish:** reconnection handling (player refreshes mid-game), large-room leaderboard payload shaping, QR code rendering, host UX for clip-processing status.

This order lets step 2 and step 3 proceed in parallel if there are two people working on it, and lets the team validate the riskiest architectural bet (the realtime room/scoring loop) before sinking time into the YouTube-extraction reliability problem, or vice versa — either order is safe because they don't block each other.

## Sources

- [Introducing a Multiplayer Quiz App Built on Salesforce Technology — Salesforce Developers Blog](https://developer.salesforce.com/blogs/2020/01/introducing-a-multiplayer-quiz-app-built-on-salesforce-technology) — general host/player/realtime-layer architecture pattern (MEDIUM confidence, cross-checked)
- [GitHub - giraygokirmak/kahoot-clone-nodejs](https://github.com/giraygokirmak/kahoot-clone-nodejs), [GitHub - ethanbrimhall/kahoot-clone-nodejs](https://github.com/ethanbrimhall/kahoot-clone-nodejs), [GitHub - jadijadi/funtest](https://github.com/jadijadi/funtest) — convergent evidence that Express + Socket.io + room-per-game-code is the de facto pattern for this exact product category (MEDIUM confidence, multiple independent implementations agree)
- [Scaling Socket.IO: Real-world challenges and proven strategies — Ably](https://ably.com/topic/scaling-socketio) — Redis adapter + sticky sessions for horizontal scaling (MEDIUM confidence)
- [Scaling Socket.IO: Redis Adapters and Namespace Partitioning — Medium](https://medium.com/@connect.hashblock/scaling-socket-io-redis-adapters-and-namespace-partitioning-for-100k-connections-afd01c6938e7) — per-instance connection limits, Redis pub/sub pattern (MEDIUM confidence)
- [How to Use FFmpeg in Node.js — Shotstack](https://shotstack.io/learn/how-to-use-ffmpeg-in-nodejs/), [yt-dlp GitHub](https://github.com/yt-dlp/yt-dlp) — yt-dlp shells out to/relies on ffmpeg for audio extraction and trimming (MEDIUM confidence)
- [Uploading Audio Files to S3 Securely — Medium](https://medium.com/@siddharthpradhan2004/uploading-audio-files-to-s3-securely-choosing-the-right-architecture-83d906f3b1a5), [Download and upload objects with presigned URLs — AWS official docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html) — presigned-URL direct-to-storage upload pattern, CDN in front of storage for serving (official AWS docs corroborate the web-sourced synthesis, raising practical confidence on this specific point)
- [How to Design a Database for Multiplayer Online Games — GeeksforGeeks](https://www.geeksforgeeks.org/dbms/how-to-design-a-database-for-multiplayer-online-games/), [Live multiplayer quiz — Ably](https://ably.com/topic/multiplayer-quiz-app-architecture) — room/player/session data model isolation pattern (MEDIUM confidence)

---
*Architecture research for: real-time multiplayer music blindtest quiz app*
*Researched: 2026-07-26*
