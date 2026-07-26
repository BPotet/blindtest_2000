# Feature Research

**Domain:** Real-time live-hosted quiz/party game (Kahoot-style) specialized for music blindtest
**Researched:** 2026-07-26
**Confidence:** MEDIUM (Kahoot mechanics cross-checked across official support docs + third-party breakdowns; blindtest-specific and open-source-clone findings are LOW confidence single-source and should be spot-checked if a phase depends heavily on them)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete or "not really Kahoot-like."

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Room join via code + QR | Kahoot/Jackbox both lead with this; it's the whole "no app install" pitch | LOW | Already in PROJECT.md scope. Kahoot shows PIN as text *and* QR simultaneously — do both, not QR-only, since some players type faster than they scan. |
| No-account player join, just a nickname | Zero-friction join is core to the genre; players are guests, only host has an account | LOW | PROJECT.md already scopes host accounts only; players stay anonymous. Confirms this is correct, not a gap. |
| Visible countdown timer during a round | Kahoot's timer is always on-screen; it's core to the "beat the clock" tension | LOW | For a 30s audio clip, timer = clip duration is the natural default; must stay visible even as audio plays. |
| One-tap multiple-choice answer buttons (large touch targets) | Kahoot's colored/shaped full-screen buttons are the genre's signature mobile interaction | LOW | Already scoped as QCM. Use big, unambiguous touch targets — the genre's players are often on beat-up phones in a dim room. |
| Answer locks in immediately on tap, no "are you sure" | Prevents fumbling and keeps pace snappy, matches Kahoot | LOW | No resubmission after first tap, per Kahoot's own behavior (and community requests to change this were declined). |
| Immediate right/wrong feedback + points earned per round | Core dopamine loop of the genre | LOW | Show correct answer, whether player got it right, and points delta before moving to leaderboard. |
| Leaderboard shown between rounds | Explicit in PROJECT.md; also universal in this genre (Kahoot, Jackbox trivia games, blindtest.gg) | LOW | Top N + player's own rank/delta if off-screen. |
| Speed+accuracy scoring | Explicit in PROJECT.md; matches Kahoot's core formula | MEDIUM | Kahoot's real formula: `points = floor((1 - (response_time/timer)/2) * max_points)`, with an instant-max threshold for very fast answers (<0.5s). Reuse this shape — it's a known-good curve players already understand. |
| Host manually advances every round (no forced auto-timer between rounds) | Explicit in PROJECT.md — matches how live hosts run a room, unlike Kahoot's classroom auto-play default | LOW | Kahoot actually supports this too (auto-play toggle off = host-paced), so this isn't unusual, just the mode this app should default to. |
| Late/mid-lobby join before round 1 starts | Kahoot allows join up to the moment host starts, and even keeps PIN visible for stragglers | LOW | Straightforward if room state is join-able until host clicks "start." |
| Host can remove/kick a disruptive player | Present in both Kahoot (lobby only) and Jackbox (added by popular demand in Party Pack 9) | LOW | Table stakes for an "open to strangers" quiz night; a troll player with an offensive nickname is a real, recurring complaint in both ecosystems. |
| Nickname moderation (profanity filter or forced rename) | Kahoot has a maintained blocklist that auto-replaces offensive nicknames; recurring pain point without it | LOW-MEDIUM | Simple denylist check on join is enough for v1; doesn't need ML moderation. |
| Mobile-first, no-install player experience (browser only) | Universal across Kahoot, Jackbox, blindtest.gg — "scan and play" is the category norm | MEDIUM | Aligns with PROJECT.md (QR to phone). Must work well on iOS Safari + Android Chrome without a native app. |
| Host screen is the "shared" audio/video surface, not each phone | Central to the genre's living-room format (Jackbox: TV/laptop is the shared screen; players' phones are controllers only) | LOW | Confirms PROJECT.md's model (clip plays on host's speakers, not each phone) is the correct genre pattern — do not build per-phone audio sync, it's unnecessary complexity for this format. |
| Reconnect after dropped wifi keeps prior score | Kahoot explicitly supports rejoin-with-score if reconnection happens without a full page reload | MEDIUM | Needs session/player-id persistence (e.g., in localStorage) so a reload during a round doesn't zero the player out. Common frustration point for Kahoot users when this fails. |

### Differentiators (Competitive Advantage)

Features that set the product apart from Kahoot specifically (its known pain points) and from generic quiz clones. Should align with Core Value: no player caps, free-form audio import, no freemium walls.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Truly unlimited players, no plan tiers | Kahoot's free/paid tiers cap players (historically ~50 free-tier participants in live games) and are the #1 stated frustration this project is solving | LOW (once architecture supports N rooms) | Already the stated Core Value in PROJECT.md — just needs an architecture that doesn't silently choke past some player count (see PITFALLS/ARCHITECTURE for the real ceiling, likely socket fan-out, not a product decision). |
| YouTube-URL + timestamp → auto-extracted clip authoring | Removes the single biggest authoring cost of a music quiz: manually cutting and hosting audio files. No mainstream Kahoot-style tool does this — hosts either upload files or link a full YouTube video (playing it live, unclipped) | HIGH | Already scoped. This is the single most differentiating feature vs. every open-source Kahoot clone found (Rahoot, ClassQuiz, Toohak) which have no audio-specific authoring at all. |
| Pre-flight clip preview/test at authoring time | Lets the host confirm the extracted 30s clip actually starts/ends where intended and that the answer isn't audible early (e.g., no sung title in the first second) *before* game night | MEDIUM | Not observed as a feature in any competitor — genre-specific insight: blindtest hosts often waste live time on a bad clip. A "preview and re-cut" step at authoring time directly prevents this. |
| Manual file-upload fallback, auto-suggested on extraction failure | Solves the real-world fragility of yt-dlp/YouTube ToS churn without making the host debug it manually | MEDIUM | Already scoped; differentiator vs. naively depending 100% on live YouTube extraction, which is what most hobby "blindtest via YouTube" setups do informally (e.g., screen-sharing a video). |
| Host writes both answer AND decoys per question | Full control over decoy quality/difficulty (a themed music night can have decoys as similarly-named tracks/artists), vs. Kahoot's generic text-entry which has no domain awareness | LOW | Already scoped, explicitly chosen over auto-generated decoys for v1 — correct call; auto-generating plausible wrong song titles is a real NLP/data problem, not worth v1 complexity. |
| No account required to *play*, but hosts get durable accounts + saved quiz library | Kahoot's model (hosts need paid tiers to reuse/organize content at scale); a small open service can give this for free, building host loyalty/retention | LOW-MEDIUM | Directly serves "no freemium restrictions" value prop from PROJECT.md. Quiz reuse across game nights is likely the biggest driver of a host coming back. |
| Room code + QR shown on host screen, no host-side app needed | Removes any host software install step — genre standard, but worth calling out as differentiator vs. tools requiring a host desktop client | LOW | Confirms an existing decision rather than introducing new scope. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create disproportionate cost or conflict with the stated v1 scope. Cross-checked against PROJECT.md's explicit Out of Scope list.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|------------------|-------------|
| Buzzer/oral "first to shout" mode | Feels more "authentic" to an in-person blind test night, common in physical trivia and in some blindtest desktop apps | Needs a fundamentally different input model (audio/button race + tie-breaking, moderation of spoken answers), doubles the interaction surface to build and test; explicitly out of scope in PROJECT.md | Ship MCQ-only v1; revisit as a v2 "game mode" once the platform's real-time core is proven |
| Auto-generated decoy answers (LLM or dataset-based) | Saves host authoring time, "smart" quiz generation is trendy | Bad decoys (too easy/too obviously wrong, or duplicate near-answers) actively wreck a quiz's fun more than doing it manually; needs a curated music metadata source and quality control that's a project of its own | Host writes decoys manually in v1 (already the PROJECT.md decision); could offer a "suggest 3 decoys" *optional* assist post-v1, always human-reviewed before saving |
| Live/on-the-fly YouTube extraction during the game | Feels convenient — host just pastes a link mid-game with no prep | Introduces YouTube-availability, extraction-latency, and yt-dlp-fragility risk directly into a live moment in front of players — a failure is maximally embarrassing and un-recoverable mid-round | Extract and validate every clip at authoring time (already the PROJECT.md decision); host tests all clips before hosting |
| Native mobile apps for players | Feels more "polished" / can request device permissions | No-install web join is the entire competitive advantage of this genre (Kahoot, Jackbox, blindtest.gg all avoid apps for players); an app adds app-store friction, review delays, and update-lag risk for zero UX gain at this game's pace | Keep player experience as a responsive web page reachable via QR/link only |
| Per-player audio (each phone plays the clip via earbuds) | Sounds fairer / lets remote players join | Breaks the shared-room social format this genre depends on (blindtest is inherently a "everyone hears the same clip from the same speaker" experience) and introduces network-latency sync problems across N phones that don't exist when there's one audio source (the host's) | Keep clip audio host-side only, exactly as scoped; remote/distributed play (not same room) is a different product, not this one |
| Monetization / paid tiers / player caps by plan | Common SaaS reflex ("how will this sustain itself") | Explicitly out of scope per PROJECT.md, and premature — it's also the exact freemium friction (player caps) this project exists to avoid reproducing | Ship free and open; revisit only if/when the service outgrows a single host's capacity to run for free |
| Deep streaming-service integration (Spotify/Deezer playlist import) at v1 | blindtest.gg and Music Quizly both offer this and it looks like an obvious feature | Requires OAuth app registration, API quota/rate limits, and licensing/ToS considerations on top of the already-nontrivial YouTube extraction pipeline — doubles the "audio sourcing" surface before the core game loop is even validated | v1 stays YouTube-URL + manual upload only (already scoped); playlist import is a reasonable v2 differentiator once the extraction pipeline is proven reliable |
| Progressive/growing audio clip reveal (à la Musicle/Songless: clip gets longer per wrong guess) | Popular mechanic in solo daily-guessing games and adds skill-based tension | Only works for single-guesser sequential-attempt games; doesn't map cleanly onto a synchronous multiplayer MCQ round where everyone answers once against a shared timer — would require re-architecting the round flow | Keep the fixed 30s clip + single MCQ answer format; consider a *distinct* solo/async game mode later if ever wanted, not a retrofit of the live-room mode |

## Feature Dependencies

```
QR/code room join
    └──requires──> Host-visible room screen showing PIN + QR simultaneously
    └──requires──> Isolated per-room game state (multi-tenant rooms, per PROJECT.md constraint)

Nickname entry
    └──requires──> Nickname moderation/profanity filter (should ship together, not bolted on later)

Speed+accuracy scoring
    └──requires──> Synchronized round-start timestamp (server-authoritative "round started at T")
    └──requires──> Server-side answer-received timestamp (not client-reported, to prevent cheating/clock skew)

Leaderboard between rounds
    └──requires──> Speed+accuracy scoring (leaderboard is a view over cumulative scores)

Host manual round advance
    └──enhances──> Host controls (kick, reveal, mute) — these all live in the same host-only control surface

Reconnect-with-score
    └──requires──> Persistent player identity across reconnect (player-id token in localStorage/URL, not just socket session)
    └──requires──> Server-side score state keyed by player-id, not by socket connection

YouTube-URL + timestamp clip extraction
    └──requires──> Pre-flight clip preview/test (extraction must produce a checkable artifact before game night)
    └──enhances──> Manual file-upload fallback (fallback UI is only useful if extraction failure is clearly surfaced)

Manual file-upload fallback
    └──requires──> Auto-detection of extraction failure (app must know extraction failed to prompt the fallback)

Host writes answer + decoys
    └──requires──> Quiz/question authoring UI (question, correct answer, N decoys, linked clip)

Host account + saved quiz library
    └──enhances──> Quiz reuse across game nights (not required for a single one-off game, but core to hosts returning)

Unlimited players
    └──conflicts──> Naive "broadcast every event to every socket" architecture at scale (see ARCHITECTURE/PITFALLS — a feature decision, but the *implementation* has a real ceiling worth flagging to the roadmap)

Live/on-the-fly extraction (ANTI-FEATURE)
    └──conflicts──> Pre-flight clip preview/test (mutually exclusive design directions — v1 explicitly picks preview-first)

Buzzer/oral mode (ANTI-FEATURE)
    └──conflicts──> MCQ-only scoring model (different input/scoring pipeline entirely; not an incremental add)
```

### Dependency Notes

- **QR/code room join requires isolated per-room game state:** PROJECT.md already flags this as an architecture constraint (multiple simultaneous hosts/parties). The join flow is trivial; the thing it depends on (room isolation) is the real roadmap-ordering item — it must be solved before any join UI is meaningful for a multi-tenant service.
- **Speed+accuracy scoring requires server-authoritative timing:** This is the one place where a naive implementation ("client reports its own response time") would be both cheatable and unfair across variable network latency. The roadmap should treat "server stamps round-start and each answer arrival" as a prerequisite task, not a scoring-formula detail.
- **Reconnect-with-score requires persistent player identity, not socket identity:** If player identity is only a socket connection, any reconnect (wifi blip, tab refresh) looks like a brand-new player with 0 points — this was called out by Kahoot's own users as their most common complaint with reconnection. Building player-id persistence in from round one avoids a rework later.
- **Clip preview/test requires extraction to happen at authoring time, not game time:** This is the same constraint already captured in PROJECT.md's "Out of Scope" (no live extraction) and its "Fiabilité extraction" constraint — the feature list here just makes explicit that preview/test is the mechanism that *realizes* that constraint, not a separate nice-to-have.
- **Nickname moderation should ship with nickname entry, not after:** Both Kahoot's and general open-lobby-game experience show offensive nicknames are a near-immediate occurrence in any semi-public room, not an edge case; treating it as a v1.x add invites a bad first impression for an "open to other hosts" service.
- **Unlimited players conflicts with naive broadcast architecture:** This isn't a feature-vs-feature conflict but a feature-vs-implementation one — worth flagging explicitly because "no player cap" is the stated Core Value, so the architecture research/roadmap must treat room-scoped socket fan-out (not global broadcast) as non-negotiable from phase 1, not a later optimization.

## MVP Definition

### Launch With (v1)

Minimum viable product — matches PROJECT.md's "Active" requirements almost exactly; feature research didn't surface anything to add to this floor, only clarified what's *inside* each item.

- [ ] Host account creation + login — needed before any authoring or hosting is possible
- [ ] Quiz authoring: YouTube URL + start timestamp → auto-extracted 30s clip — the core content-creation loop
- [ ] Clip preview/re-test at authoring time — without this, extraction bugs surface live in front of players (differentiator, but load-bearing for the "no live extraction" decision to actually work)
- [ ] Manual file-upload fallback, auto-suggested on extraction failure — required per PROJECT.md constraint, not optional
- [ ] Per-question answer + decoys, host-authored — table stakes for MCQ scoring to function at all
- [ ] Room creation with QR code + join code, isolated per-room state — table stakes and the multi-tenant architecture anchor
- [ ] Host-paced round advance (no forced timer between rounds) — explicit PROJECT.md requirement, differentiates from classroom-style auto-play defaults
- [ ] Player mobile join (nickname, no account) + MCQ answer UI with countdown — table stakes for the whole genre
- [ ] Nickname profanity filter — small effort, prevents a first-impression failure in an open service
- [ ] Server-authoritative speed+accuracy scoring + between-round leaderboard — explicit PROJECT.md requirement and the core competitive loop
- [ ] Reconnect-with-score (basic) — prevents the most common Kahoot user complaint from day one
- [ ] No artificial player cap — the stated Core Value; validate under realistic room sizes, not just claimed as a feature

### Add After Validation (v1.x)

Features to add once the core loop is proven with real game nights.

- [ ] Host kick-player control mid-lobby — add once real hosting sessions surface disruptive-player cases (low cost, but not blocking to prove the concept)
- [ ] Quiz library / reuse across sessions for a host account — add once hosts are running more than one game night and want to reuse content
- [ ] Richer host controls (mute sound effects, toggle show-answer-on-player-device) — add based on actual host feedback from early sessions, not speculative parity with Kahoot
- [ ] Optional decoy-suggestion assist (human-reviewed) — only after enough authored quizzes exist to judge whether manual decoy-writing is actually a bottleneck

### Future Consideration (v2+)

Features to defer until the core product and multi-host model are validated.

- [ ] Streaming-service playlist import (Spotify/Deezer) — defer until the YouTube-extraction pipeline is proven reliable in production; adds a second, licensing-sensitive audio-sourcing surface
- [ ] Buzzer/oral answer mode as an alternate game mode — defer; explicitly out of v1 scope and a genuinely different interaction/scoring model, not an incremental feature
- [ ] Progressive-reveal solo/async game mode (Musicle/Songless-style) — defer; a fundamentally different (non-live, non-room-based) product surface, worth exploring only after the live-room product has traction
- [ ] Monetization / paid tiers — explicitly deferred per PROJECT.md; revisit only if the free service's hosting cost or scale genuinely requires it

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Room QR/code join + isolated room state | HIGH | MEDIUM | P1 |
| YouTube URL + timestamp auto-extraction | HIGH | HIGH | P1 |
| Clip preview/test at authoring time | HIGH | MEDIUM | P1 |
| Manual upload fallback on extraction failure | HIGH | MEDIUM | P1 |
| Host-authored answer + decoys | HIGH | LOW | P1 |
| Player MCQ answer UI + countdown | HIGH | LOW | P1 |
| Server-authoritative speed+accuracy scoring | HIGH | MEDIUM | P1 |
| Between-round leaderboard | HIGH | LOW | P1 |
| Host-paced manual round advance | HIGH | LOW | P1 |
| Unlimited players (validated at scale) | HIGH | HIGH (architecture-dependent) | P1 |
| Nickname profanity filter | MEDIUM | LOW | P1 |
| Reconnect-with-score | MEDIUM | MEDIUM | P1 |
| Host kick-player | MEDIUM | LOW | P2 |
| Quiz library / reuse for host accounts | MEDIUM | LOW | P2 |
| Additional host controls (mute FX, show-answer toggle) | LOW | LOW | P2 |
| Decoy-suggestion assist | LOW | MEDIUM | P3 |
| Streaming-service playlist import | MEDIUM | HIGH | P3 |
| Buzzer/oral answer mode | LOW (for this product's stated audience) | HIGH | P3 |
| Progressive-reveal solo mode | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | Kahoot | Jackbox Games | blindtest.gg / open-source clones | Our Approach |
|---------|--------|----------------|-------------------------------------|--------------|
| Room join | 6-digit PIN + QR, no account | 4-letter room code, phone becomes controller | Room code / public+private rooms | PIN/code + QR, phone is the answer device (matches genre norm) |
| Player cap | Free tier historically capped participants; paid tiers raise/remove cap | Typically capped per game type (~8 players by design, not a monetization lever) | blindtest.gg: not clearly capped; ClassQuiz self-hosted tested to ~300 | No artificial cap — the stated differentiator vs. Kahoot's freemium model |
| Content source | Text/image questions; audio-as-question exists on paid tiers (TTS or short uploaded clip) | Pre-built party games, not user-authored content | Curated genre playlists + Spotify/Deezer playlist import | YouTube URL + timestamp auto-extraction, purpose-built for music quizzes (no direct competitor does this well) |
| Answer input | MCQ (shapes/colors), true/false, poll, some open text | Varies wildly by game (drawing, text, voting) — not comparable | MCQ, guess title+artist | MCQ with host-authored decoys, per PROJECT.md |
| Pacing | Auto-play (host/teacher-timed default) or fully self-paced Challenge Mode | Host-paced, host explicitly starts each round from lobby | Timed rounds, largely automatic | Fully host-paced between rounds, no forced timer — matches Jackbox's model more than Kahoot's classroom default |
| Scoring | Speed+accuracy formula, optional streak bonus | Game-specific (voting, drawing scores — not comparable) | Speed-based (guess fastest wins) | Kahoot-style speed+accuracy formula, proven and player-familiar |
| Reliability of audio source | Uploaded files or short TTS/audio blocks, no video-extraction dependency | N/A (games are pre-built, no user audio) | Playlist streaming APIs (Spotify/Deezer), stable licensed sources | YouTube extraction with tested fallback to manual upload — higher risk than competitors' approach, but avoids licensing/API integration cost of streaming platforms |

## Sources

- [How to host a live kahoot](https://support.kahoot.com/hc/en-us/articles/360039422694-How-to-host-a-live-kahoot) — MEDIUM confidence (official docs)
- [How to find Kahoot! PIN](https://support.kahoot.com/hc/en-us/articles/360000109048-How-to-find-Kahoot-PIN) — MEDIUM
- [How to use the 2-step Join option to secure your game](https://support.kahoot.com/hc/en-us/articles/35342050693789-How-to-use-the-2-step-Join-option-to-secure-your-game) — MEDIUM
- [Live game settings – Kahoot Help Center](https://support.kahoot.com/hc/en-us/articles/115016055107-Live-game-settings) — MEDIUM
- [How to enable "See questions on participant's screen"](https://support.kahoot.com/hc/en-us/articles/115003197928-How-to-enable-See-questions-on-participant-s-screen-in-Kahoot-live-games) — MEDIUM
- [How points work – Kahoot Help Center](https://support.kahoot.com/hc/en-us/articles/115002303908-How-points-work) — MEDIUM
- [Kahoot Scoring Explained (community breakdown of official formula)](https://gamesadda.in/gaming/kahoot-scoring-explained/) — LOW (third-party, cross-checked against official docs)
- [Kahoot! question types](https://support.kahoot.com/hc/en-us/articles/115002308428-Kahoot-question-types) — MEDIUM
- [How to make a kahoot](https://support.kahoot.com/hc/en-us/articles/115002884788-How-to-make-a-kahoot) — MEDIUM
- [Rejoining – Kahoot Help Center](https://support.kahoot.com/hc/en-us/community/posts/28689030850963-Rejoining) — MEDIUM
- [What happens if I get disconnected during a game? - Kahoot Join](https://kahootjoincode.com/what-happens-if-i-get-disconnected-during-a-game/) — LOW (third-party)
- [How to handle inappropriate nicknames – Kahoot Help Center](https://support.kahoot.com/hc/en-us/articles/115002201267-How-to-handle-inappropriate-nicknames) — MEDIUM
- [Safety guide for content on Kahoot! – Kahoot Trust Center](https://trust.kahoot.com/safety-guide-for-content/) — MEDIUM
- [New: add audio to Kahoot! questions](https://kahoot.com/blog/2021/06/14/new-add-audio-to-kahoot-questions/) — MEDIUM (official blog)
- [Jackbox TV Join Explained](https://explore.st-aug.edu/exp/jackbox-tv-join-explained-how-a-simple-code-unlocks-a-world-of-party-games) — LOW (third-party)
- [The Ability To Kick Players and Other New Features Coming To Party Pack 9](https://www.jackboxgames.com/blog/the-ability-to-kick-players-and-other-new-features-coming-to-party-pack-9) — MEDIUM (official blog)
- [How to Play – Jackbox Games](https://www.jackboxgames.com/how-to-play) — MEDIUM (official)
- [Blindtest.gg](https://blindtest.gg/en) — LOW (product marketing page, single source)
- [Music quiz online: guess the song with your friends | Blindtest.gg](https://blindtest.gg/en/blog/blind-test-en-ligne) — LOW
- [GitHub - mauricesvay/Blindtest (open-source multiplayer blindtest, up to 16 players)](https://github.com/mauricesvay/Blindtest) — LOW
- [Rahoot – Alternative to Kahoot!](https://nosubscription.org/software/rahoot/) — LOW (aggregator listing)
- [GitHub - Ralex91/Razzia](https://github.com/Ralex91/Razzia) — LOW
- [ClassQuiz – Open Source Alternative to Kahoot](https://opensourcealternative.to/project/classquiz) — LOW
- [GitHub - Arc676/Toohak](https://github.com/Arc676/Toohak) — LOW
- [Musicle / Songless / Guess The Audio game descriptions – Dle Games](https://dlegames.org/game/musicle) — LOW (used only to characterize the anti-feature "progressive reveal" pattern, not a direct competitor)
- [Trivia Round Format Ideas](https://triviahosthelp.com/blog/trivia-round-format-ideas/) — LOW (general trivia-night context)

---
*Feature research for: real-time Kahoot-style music blindtest web app*
*Researched: 2026-07-26*
