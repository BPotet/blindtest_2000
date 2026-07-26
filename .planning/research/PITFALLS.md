# Pitfalls Research

**Domain:** Real-time multiplayer music-blindtest web app (Kahoot-like), with server-side YouTube audio extraction and multi-tenant host accounts
**Researched:** 2026-07-26
**Confidence:** MEDIUM overall (LOW-confidence web sources cross-checked against each other and against well-documented GitHub issue trackers for the specific libraries involved; legal claims are informational, not legal advice)

## Critical Pitfalls

### Pitfall 1: Treating YouTube extraction as a solved, stable dependency

**What goes wrong:**
The team builds the whole quiz-creation flow assuming "paste a YouTube URL + timestamp, get a clip" always works, then discovers in production that a chunk of extractions silently fail or the extractor breaks entirely after a YouTube update, right before a host's event.

**Why it happens:**
yt-dlp (the de facto standard extraction tool) depends on reverse-engineering YouTube's player signature/cipher and bot-detection logic. YouTube changes these mechanisms periodically; yt-dlp maintainers typically patch within hours to days, but any given day-of can have extraction down for hours. Separately, YouTube's bot-detection increasingly challenges requests from **datacenter/cloud IP ranges** (AWS, GCP, Render, etc.) with a "Sign in to confirm you're not a bot" wall — this hits exactly the kind of small hosted Node/Python backend this project will run on, not just occasional home users. Workarounds (browser-cookie auth, proof-of-origin token providers, residential proxies, client spoofing) all add cost, brittleness, and maintenance burden.

**How to avoid:**
- Treat extraction as "best-effort, must degrade gracefully" from day one — this project's manual-upload fallback (already scoped) is the correct architectural answer, not an afterthought.
- Extract synchronously at quiz-creation time (already decided) — never in front of players during a live game.
- Pin yt-dlp to a version and monitor its release feed; budget recurring maintenance time for extractor breakage, don't treat it as a one-time integration cost.
- Plan for IP-reputation issues from day one: if self-hosting on a common cloud provider, expect intermittent bot-walls and design the "extraction failed" UX (auto-offer manual upload) to trigger on this failure mode specifically, not just on "video unavailable."
- Keep ffmpeg-based clip cutting decoupled from the extraction step so a future swap of extraction method (or fallback to yt-dlp alternatives) doesn't require rearchitecting the pipeline.

**Warning signs:**
- Extraction success rate silently degrading in logs/metrics.
- Support requests clustering around "extraction failed" for videos that work fine when tested manually from a residential IP.
- yt-dlp version pinned months ago with no update cadence in place.

**Phase to address:** Quiz-creation / audio-extraction phase (core pipeline build), with the fallback-upload UX in the same phase, not deferred.

---

### Pitfall 2: Client clock trusted for speed-based scoring

**What goes wrong:**
A player's device reports "I answered at T+2.1s" and the server scores based on that self-reported time, or the server measures elapsed time using a client-side "round started" timestamp broadcast over WebSocket. Result: players can trivially cheat by manipulating client timestamps, and even without cheating, network latency and device clock drift (documented drift of ~50ms per 10 minutes, worse on mobile) produce unfair scoring — a player with better latency to the server always wins close calls regardless of true reaction speed.

**Why it happens:**
It's simpler to let the client report "how fast I answered" than to build proper server-authoritative timing, especially when the team is focused on getting the core loop working first.

**How to avoid:**
- The server is the single source of truth for "round started at time X" and "answer received at server time Y." Speed score = server-receive-time minus server-round-start-time, never a client-reported delta.
- Broadcast round-start as a server-issued event and immediately have the server log its own send timestamp; do not rely on the client's receipt time as "when the clip started," since network jitter differs per player.
- If tighter fairness matters later, use a lightweight round-trip-time (RTT) estimate per player (ping/pong) to normalize scoring, but this is a refinement, not a v1 blocker — start with pure server-timestamp scoring, which is already good enough for a casual party game.
- Document explicitly that the host's audio playback moment (the clip actually starts on the host's speakers) is not perfectly synchronized with the server's "round start" broadcast — see Pitfall 5.

**Warning signs:**
- Score calculation code reads any time value from the incoming player payload.
- QA reports that players on Wi-Fi consistently score higher/lower than players on cellular for reaction speed alone.

**Phase to address:** Real-time game-loop / scoring phase — must be part of the initial round-flow design, not bolted on after.

---

### Pitfall 3: No reconnect/rejoin strategy for dropped player connections

**What goes wrong:**
A player's phone drops Wi-Fi or the browser backgrounds mid-round (very common on mobile — screen lock, notification, app switch). Without explicit handling, the player is either permanently kicked from the game, loses their score/session, or reconnects into a broken state (e.g., can answer a round twice, or is stuck on a stale screen forever).

**Why it happens:**
Mobile network transitions and backgrounding are the normal case, not the edge case, for phone-based multiplayer — but it's easy to build and test only against a stable laptop WebSocket connection during development.

**How to avoid:**
- Design the player client to always assume the WebSocket can and will drop; implement automatic reconnect with exponential backoff and a capped retry window (e.g., 10-15 attempts / 2-5 minutes) before showing the player a "disconnected" state.
- Use a stable player identity (session token stored client-side, e.g. in localStorage/sessionStorage) so a rejoin restores the same player's score/seat in the room rather than creating a duplicate.
- On reconnect, the server should push the current authoritative room state (current round, time remaining if mid-round, whether this player already answered) rather than assuming the client's local state is valid.
- Use application-level heartbeats to detect dead connections quickly (TCP-level detection is unreliable on mobile networks); 2-3 missed heartbeats is a reasonable threshold.
- Decide product behavior explicitly: if a player reconnects mid-round after the answer window closed, they should see the round as "missed," not be allowed to answer late.

**Warning signs:**
- No player identity/session token — server treats every WebSocket connection as a brand-new anonymous player.
- Manual testing only done with stable desktop browser tabs, never with a real phone locking its screen mid-round.

**Phase to address:** Real-time room/session phase — session identity and reconnect handling should be designed alongside the initial join-flow, not retrofitted after the game loop is "done."

---

### Pitfall 4: Late-answer race conditions ("answering after time's up")

**What goes wrong:**
A player's answer arrives at the server just after the round has been marked closed (due to network latency, not player unfairness), and the server either rejects it inconsistently, double-counts it, or a race between "close round" and "record answer" logic causes some players' legitimate in-time answers to be dropped.

**Why it happens:**
Round-closing and answer-recording are often implemented as two independent event handlers without a single authoritative cutover point, especially once host-controlled advance ("host clicks next when ready") is combined with any optional timer — a natural source of off-by-one-message races.

**How to avoid:**
- Make round state a single authoritative value on the server (e.g., `state: "open" | "closed"` per round) and check it atomically when an answer arrives — no answer is accepted once state flips to closed, full stop, regardless of arrival-time heuristics.
- Since the host manually advances rounds (no imposed timer per this project's scope), the cutover moment is host-triggered — make sure the "close answers" signal and the "advance to next round" signal are the same atomic server-side action, not two separate broadcasts that can arrive out of order to different players.
- Log/expose (at least in dev) a count of "answers rejected as late" to catch systemic timing problems (e.g., a slow player population near a soft-launch venue with bad Wi-Fi) versus one-off outliers.

**Warning signs:**
- Answer-acceptance logic implemented with wall-clock comparisons across client and server rather than a single server-side state flag.
- Bug reports of "I answered but got zero points" without a clear inconsistency reason.

**Phase to address:** Real-time game-loop phase, same phase as Pitfall 2/3.

---

### Pitfall 5: Assuming "host plays audio aloud" needs no engineering — breaks on autoplay policy and on room/sync assumptions

**What goes wrong:**
The core UX assumption ("host's laptop/phone plays the clip through speakers, everyone in the room hears it, no per-player audio streaming needed") is deceptively simple but has real failure modes: (1) the host's browser blocks the very first audio playback due to autoplay restrictions, so the first round's audio silently fails to play; (2) precise 30-second clip playback (start at exact timestamp, stop at exact +30s) behaves inconsistently across browsers/devices for `seek()` accuracy and `ended` event timing; (3) the product design implicitly assumes all players are physically co-located within earshot of the host's speakers, which is fine for the stated use case but will surprise a host who assumes remote players "just work" like Kahoot's audio jingles do on players' own devices — Kahoot itself plays UI sound on the shared screen only, not per-player, so this assumption isn't unusual, but it should be a documented product constraint, not a silent limitation discovered by a confused host.

**Why it happens:**
Autoplay policies (especially iOS Safari, which blocks all autoplay with sound until a user gesture unlocks the audio context) are easy to miss in early desktop-only testing. Precise audio clip timing is also easy to test informally ("sounds about right") without validating stop/seek accuracy across actual host devices (a host is as likely to run the show from a phone/tablet as from a laptop).

**How to avoid:**
- Require a host-side "tap to enable sound" gesture once per session (e.g., on the "create/start game" screen) to unlock the audio context before the first round, on every browser/OS the host might use — this is a one-time interaction, not per-round.
- Test precise clip start/stop across the actual target host devices (not just one dev machine): Chrome desktop, Safari desktop, Safari iOS, Chrome Android at minimum, since `<audio>`/`<video>` seek precision and autoplay rules diverge meaningfully between these.
- Pre-extract clips as already-trimmed files (already the plan) rather than seeking into a long source file at playback time — this removes seek-accuracy as a live-playback concern and pushes precision to the offline ffmpeg extraction step, which is easier to validate once.
- Explicitly document the "same room, shared speakers" assumption as a product constraint in onboarding/help copy, so hosts running a hybrid remote game don't assume it will work like it does for players' individual devices.

**Warning signs:**
- First-round audio silently not playing in QA on iOS Safari while working fine on desktop Chrome.
- Clip duration or start-offset drifting by hundreds of milliseconds to seconds when tested on the actual target device vs. dev machine.

**Phase to address:** Host game-screen / playback phase — audio-unlock gesture and cross-device playback testing should be a phase acceptance criterion, not discovered post-launch.

---

### Pitfall 6: Multi-tenant room state leaks or is never cleaned up

**What goes wrong:**
As multiple hosts run concurrent games, room state (Socket.IO rooms, in-memory game objects, Redis keys) accumulates and is never torn down for abandoned games (host closes the tab without ending the game, or a quiz is created but never played). Over weeks, this manifests as slow memory growth, stale rooms appearing in internal listings, or — worse — one host's game state leaking into another's due to inadequate namespacing.

**Why it happens:**
Socket.IO has well-documented footguns here: empty rooms are not always automatically deleted on disconnect, and some adapter APIs (e.g., `adapter.clients()`/`allRooms()`) are known to leak memory under load; the safer standard `.rooms` object avoids this but requires deliberate use. It's also easy to build room creation without a matching "idle timeout → destroy" job, since it's not needed to make the demo work.

**How to avoid:**
- Namespace every game explicitly by a server-generated room ID; never rely on implicit socket-room defaults for tenant isolation — validate on every message that the acting socket is a member of the room it claims to act in.
- Build an idle-room reaper from day one: any room with no host activity (or no host socket connected) for N minutes is torn down and its resources freed — this is cheap to build early and expensive to retrofit once "orphaned rooms in production" becomes a support issue.
- Avoid the flagged-leaky Socket.IO adapter APIs; use the standard `.rooms`/`.sockets` accessors, and disable `perMessageDeflate` if profiling shows memory instability under load.
- If scaling beyond a single process, use the Redis adapter (or equivalent) for room state — but don't reach for this until concurrent-room load actually requires horizontal scaling (see Pitfall 8 on over-engineering).

**Warning signs:**
- No code path that ever deletes a room object except "game explicitly ended by host."
- Room/session count in memory/logs only ever goes up, never down, over a multi-day test run.

**Phase to address:** Room/session infrastructure phase (whichever phase introduces multi-room support) — cleanup/reaper logic should ship in the same phase as room creation, not as a later "scaling" phase.

---

### Pitfall 7: Underestimating extracted-clip storage growth and copyright exposure of hosting music clips

**What goes wrong:**
Every quiz question with a successfully extracted (or uploaded) clip permanently stores a 30-second audio file. With no retention policy, storage grows unboundedly as hosts create quizzes, and — separately — the service is directly storing and serving copyrighted music clips it extracted itself (not just hosting arbitrary user uploads), which is a materially different legal posture than a pure user-generated-content host: DMCA safe-harbor protections are strongest for platforms passively hosting user uploads and responding to takedowns, and weaker for services whose own extraction pipeline is the affirmative act producing the copyrighted copy. A 2026 US federal court ruling specifically found that using stream-ripping tools to download YouTube clips can trigger DMCA anti-circumvention liability, independent of fair-use arguments about the underlying content.

**Why it happens:**
Storage costs feel negligible at small scale (a few hosts, a few quizzes) and the legal distinction between "hosting user uploads" and "extracting content ourselves" is easy to overlook when the extraction feature is the headline feature of the product.

**How to avoid:**
- Build a storage lifecycle policy early: quiz clips tied to a host account that's inactive/deleted should be reclaimable; consider a "quiz not played in N months" soft-cleanup path even at small scale, so this isn't a surprise re-architecture later.
- Keep clip storage scoped per-host and access-controlled — no public clip URLs beyond what's needed for playback during an active game, since broadly discoverable copyrighted-clip URLs increase both bandwidth cost and takedown-notice surface area.
- Treat this as a "small, personal/friend-group tool that happens to have accounts" risk profile rather than a public commercial music-streaming risk profile — the product's framing (private quizzes for friends, not a public music-clip library) matters legally and practically; avoid building discovery/browse features that expose other hosts' extracted clips publicly.
- Have a basic takedown-response process ready before opening signups broadly (a way to identify and delete a specific clip quickly), even if informal at this stage — this is cheap insurance, not over-engineering.
- This is not a "block launch" issue at hobby/small-scale-service size, but it should be a conscious, documented risk the project owner accepts, not an unexamined assumption.

**Warning signs:**
- No code path or admin capability to delete/find a specific stored clip quickly.
- Total storage growth never modeled against expected host/quiz counts.

**Phase to address:** Quiz-creation/storage phase (retention policy + admin deletion capability) should be scoped alongside the extraction feature; legal/ToS risk disclosure is a product-decision item for the project owner, not purely an engineering task.

---

### Pitfall 8: Over-engineering real-time infrastructure before validating the core loop

**What goes wrong:**
Because this is explicitly a "small open multi-tenant service," it's tempting to build for hypothetical scale up front: Redis-backed horizontal scaling, sophisticated matchmaking, a full event-sourced game-state model, or a custom protocol instead of a well-supported library — all before a single real game has been played end-to-end. Indie-project data backs this up broadly: scope-too-large is one of the most commonly cited reasons projects stall or are abandoned before shipping.

**Why it happens:**
"Multi-tenant" and "real-time" sound like they demand heavyweight infrastructure, and it's more intellectually interesting to build a scalable system than to ship a working single-process version first.

**How to avoid:**
- Start with a single-process WebSocket server holding room state in memory; this comfortably supports many concurrent small rooms (tens of hosts, unlimited players per room within reason) without Redis, sharding, or multi-instance coordination — add horizontal scaling only when real usage data shows a single process is the bottleneck.
- Use a well-supported real-time library (Socket.IO or equivalent) rather than hand-rolling reconnection/room semantics — the ecosystem has already solved connection management, fallbacks, and room primitives; reinventing this is a classic time sink.
- Sequence the roadmap so the full vertical slice (host creates quiz → room → players join → round plays → answer → score → leaderboard) ships and is played end-to-end before investing in anything this document flags as a "phase 2+" concern (horizontal scaling, proxy/cookie infrastructure for extraction robustness, admin tooling for clip moderation).
- Explicitly revisit the Out of Scope list (buzzer mode, auto-generated decoys, live extraction) at each milestone boundary rather than letting them creep back in mid-build.

**Warning signs:**
- Infrastructure decisions (Redis, message queues, microservices) made before a single real game has been hosted with real players.
- Roadmap phases named after infrastructure components rather than user-facing capabilities.

**Phase to address:** Roadmap/architecture decision made at project kickoff — this is a standing constraint across all phases, not a single phase's job, but should be explicitly called out when the roadmap is drafted so infra-heavy phases are sequenced last, gated on real usage evidence.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| In-memory-only room state (no persistence/Redis) | Fast to build, no extra infra | Server restart kills all live games; can't horizontally scale later without refactor | Acceptable through MVP and early usage; revisit once concurrent-room load or uptime requirements demand it |
| Client-reported timestamps used as a scoring hint alongside server time | Simpler client code | Reopens the cheating/fairness door if the server ever trusts it even partially | Never acceptable for the authoritative score value itself |
| No idle-room reaper (rooms live until process restart) | One less system to build early | Slow memory growth, stale-state bugs, confusing internal debugging | Only acceptable for a short private-beta period with a handful of known hosts; must ship before public signups |
| Skipping cross-browser audio testing (test only on one dev machine) | Faster to "feels done" | Silent audio failures in production on iOS Safari or other browsers | Never acceptable — must be validated before the playback phase is marked complete |
| No storage retention/cleanup policy for clips | Simpler initial storage code | Unbounded storage growth, harder retrofit, weaker takedown-response posture | Acceptable for first weeks of testing only; must exist before opening signups to unknown hosts |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|------------------|-------------------|
| yt-dlp / YouTube extraction | Assuming extraction is reliable and stable long-term; running it from a cloud/datacenter IP without expecting bot-walls | Treat as best-effort with automatic fallback to manual upload (already scoped); pin/monitor yt-dlp version; expect and design for intermittent datacenter-IP blocking |
| Socket.IO rooms | Using leak-prone adapter APIs (`adapter.clients()`, `allRooms()`) or assuming empty rooms self-delete | Use standard `.rooms`/`.sockets` accessors; build an explicit idle-room reaper rather than relying on library defaults |
| HTML5 `<audio>` autoplay (host device) | Assuming programmatic `play()` will always work once the game screen loads | Require one host-side gesture ("tap to start") per session before first playback; test on actual target host devices, not just dev machine |
| Player session/identity over WebSocket | Treating every new WebSocket connection as a new anonymous player | Issue a stable client-side session token on join; use it to restore player identity/score on reconnect |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| In-memory single-process room state | Fine at small scale | Horizontal scale via Redis adapter only when needed | Likely fine well beyond dozens of concurrent rooms on modest hardware; revisit only with real evidence of CPU/memory pressure |
| Unbounded stored audio clips | Storage bill/disk usage creeps up unnoticed | Retention policy, per-host quotas, cleanup for abandoned quizzes | Becomes visible once host count or quiz-per-host count grows past what was originally modeled — model this early even if enforcement comes later |
| No reconnect backoff cap | A flaky player connection hammers the server with reconnect attempts | Capped retries with exponential backoff (10-15 attempts / 2-5 min) | Noticeable once real mobile-network conditions are tested (venue Wi-Fi, cellular handoff) |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Trusting client-reported answer time or score | Players can trivially cheat by manipulating client timestamps | All scoring derived from server-side receive timestamps only |
| No validation that a socket acting in room X is actually a member of room X | Cross-room interference/spoofing between simultaneous games (multi-tenant isolation break) | Validate room membership server-side on every incoming event, not just at join time |
| Publicly guessable/enumerable room codes without expiry | Uninvited strangers could join a private game by guessing codes | Use sufficiently random room codes/QR tokens with a reasonable expiry tied to game lifecycle |
| Storing/serving extracted clips at broadly accessible public URLs | Increases both bandwidth cost and copyright-takedown exposure | Scope clip access to the host's own quizzes and active game sessions, not public/discoverable URLs |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| No visible reconnect/rejoin feedback on player phones | Player thinks the app is broken when Wi-Fi blips; may quit mid-game | Show explicit "reconnecting..." state and restore the player to the correct round/score on success |
| No host-side "unlock audio" moment before the first round | First round plays silently, host panics/interrupts flow | A single deliberate "start game" tap that also unlocks audio playback |
| Late-answer players get no rejection feedback | Player is confused why they got zero points despite answering | Clear "time's up" state shown immediately when the round closes, even if their answer is in flight |
| Silent extraction failures with no automatic fallback prompt | Host discovers a broken question live during the party | Detect extraction failure at quiz-creation time and immediately prompt the manual-upload fallback (already scoped as a requirement) |

## "Looks Done But Isn't" Checklist

- [ ] **YouTube extraction:** Often missing real fallback trigger logic — verify the manual-upload prompt actually fires automatically on extraction failure, not just when the host notices and asks for it.
- [ ] **Scoring:** Often missing server-authoritative timing — verify by testing with an artificially throttled/high-latency player connection and confirming score fairness doesn't degrade.
- [ ] **Reconnect handling:** Often missing entirely in first builds — verify by locking a test phone's screen mid-round and confirming the player rejoins with correct state, not a duplicate or lost session.
- [ ] **Audio playback:** Often tested only on one desktop browser — verify precise clip start/stop and unlock-gesture behavior on iOS Safari and Android Chrome specifically.
- [ ] **Room isolation:** Often missing membership validation — verify that a malicious/buggy client can't send events affecting a room it hasn't joined.
- [ ] **Room cleanup:** Often entirely absent — verify that a room with a disconnected host for N minutes is actually removed from memory, not just from the UI.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Client-trusted scoring shipped, cheating discovered | MEDIUM | Refactor scoring path to server-authoritative timestamps; requires a scoring-logic rewrite but no data-model change if round/answer events are already logged server-side |
| No reconnect handling, players getting kicked | MEDIUM | Add session token + server-state resync on reconnect; retrofit is straightforward if room state was already modeled per-player rather than per-socket |
| Room memory leak discovered in production | LOW-MEDIUM | Add idle-room reaper and switch off leak-prone adapter APIs; can be deployed without a data migration |
| Extraction fully breaks after a YouTube change | LOW | Fall back entirely to manual upload until yt-dlp is patched/updated; the manual-upload path already exists as a requirement, so this is a graceful degradation, not an outage |
| Storage growth uncontrolled, costs spike | MEDIUM | Introduce retention policy retroactively (e.g., archive/delete clips for quizzes inactive > N months) with host notification before deletion |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Fragile YouTube extraction | Quiz-creation / audio-extraction phase | Extraction-failure path tested explicitly (e.g., feed a private/removed video URL) and confirm automatic fallback-to-upload UX fires |
| Client-clock scoring unfairness | Real-time game-loop / scoring phase | Load-test scoring with artificial network latency injected on one simulated player; confirm fairness holds |
| No reconnect/rejoin handling | Real-time room/session phase | Manual test: lock a phone screen mid-round, confirm correct rejoin state |
| Late-answer race conditions | Real-time game-loop phase | Stress-test answers arriving at/after the exact round-close boundary; confirm consistent accept/reject behavior |
| Audio autoplay/precision failures | Host game-screen/playback phase | Cross-device manual test matrix (Chrome desktop, Safari desktop, Safari iOS, Chrome Android) before phase sign-off |
| Multi-tenant room leakage/no cleanup | Room/session infrastructure phase | Run multiple concurrent test rooms, abandon one without ending it, confirm it's reaped within the expected window |
| Unbounded clip storage / copyright exposure | Quiz-creation/storage phase | Confirm an admin/owner deletion path exists and a retention policy decision is documented, even if enforcement ships later |
| Over-engineered real-time infra too early | Roadmap/architecture decision (project kickoff) | Roadmap review: confirm infra-heavy phases (horizontal scaling, proxy infra) are sequenced after a working end-to-end vertical slice, not before |

## Sources

- yt-dlp GitHub issue tracker (throttling, IP bans, "sign in to confirm you're not a bot", fragment-retries) — community-reported, LOW confidence individually, consistent across multiple issues
- Hacker News discussion on YouTube cracking down on yt-dlp IP blocking (news.ycombinator.com/item?id=43398222)
- Slashdot / Medianama coverage of a 2026 US federal court ruling on YouTube stream-ripping and DMCA anti-circumvention liability — LOW confidence (secondary news coverage, not primary case text reviewed directly)
- Justia / TermsFeed overviews of DMCA safe harbor requirements
- Ably engineering content on real-time multiplayer quiz architecture (Socket.IO + Redis patterns)
- Socket.IO official docs (memory-usage guidance) and GitHub issues on room-cleanup/memory-leak reports
- websocket.org guides on reconnection and state-recovery patterns
- GameDev.net forum discussions on client/server clock drift and authoritative timing
- Bitmovin / Apple developer docs on mobile autoplay restrictions
- Wayline indie-dev scope-creep analysis

**Note on confidence:** All findings are sourced from general web search (no curated/official-docs MCP providers were configured for this run), so the baseline confidence tier is LOW per this project's classification rules. Findings were cross-checked across multiple independent sources (e.g., yt-dlp bot-detection issues corroborated across GitHub issues, Hacker News, and third-party guides) to increase practical reliability, but none of these claims should be treated as verified/authoritative without a spot-check against current yt-dlp documentation and current YouTube ToS at implementation time — this is an area that changes quickly.

---
*Pitfalls research for: Real-time Kahoot-like music blindtest web app*
*Researched: 2026-07-26*
