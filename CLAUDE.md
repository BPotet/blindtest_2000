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

<!-- GSD:project-start source:.planning/PROJECT.md -->
## Project

**Blindtest 2000 — Music Quiz Web App**

A web application for hosting music "blindtest" games: players hear a short audio extract and guess the track/artist. The core mechanic is producing a precise **30-second audio clip** from a given song, starting at a chosen timestamp.

1. **YouTube extraction (primary path)** — Given a YouTube URL and a start timestamp, the app downloads the source audio and trims it to an exact 30-second clip for playback during the game.
2. **Manual upload (fallback path)** — When YouTube extraction fails (region lock, unavailable/private video, copyright takedown, no reliable audio stream, etc.), the user can upload their own audio file and the app trims/prepares the same 30-second clip from it.
3. **Blindtest gameplay** — Clips are queued and played to players who guess the title/artist within the round; the exact scoring/round format is still to be defined via OpenSpec.

### Domain Glossary

- **Blindtest** — A music guessing game: a short clip plays, players guess the song/artist before revealing the answer.
- **Clip** — The prepared 30-second audio segment used during a round.
- **Extraction** — The process of turning a YouTube URL + start timestamp into a clip (download + trim).
- **Fallback upload** — Manual audio upload path used when automatic YouTube extraction is not possible.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:.planning/codebase/STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:.planning/codebase/CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:.planning/codebase/ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## Workflow Enforcement (OpenSpec → GSD)

Specs come from OpenSpec; implementation runs through the automatic GSD loop. Before using Edit, Write, or other file-changing tools for feature work, ensure an OpenSpec spec exists, then start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- Author/update the **OpenSpec spec** first — it is the contract GSD verifies against
- `/gsd-new-project` to bootstrap the roadmap (first time only)
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-plan-phase` / `/gsd-execute-phase` for planned phase work (runs automatically — no human checkpoints)

Do not make direct repo edits outside this workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
