# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`phatblat/claude-code-review` — a GitHub Action that performs generate-then-verify AI code review on pull requests using [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action). Posts line-level comments with applyable suggestions at a tunable noise level, using your own API key (not the managed Code Review service).

## Commands

```bash
npm test              # vitest — 40 tests, ~2s, no network
npm run test:watch    # vitest watch mode
npm run typecheck     # tsc --noEmit (strict mode)
npx vitest run test/diffmap.test.ts   # single test file
```

## Architecture

Two layers separated by a strict boundary — **judgment in prompts, plumbing in code**.

### Prompt layer (`.claude/agents/`, `prompts/coordinator.md`)

Model judgment; not unit-tested — evaluated via a labeled corpus instead.

1. **Generation pass** (recall-biased): `logic-reviewer` and `security-reviewer` subagents emit JSONL candidates. Deliberately over-eager; false positives are cheap here.
2. **Verification pass** (precision-biased): `finding-verifier` receives ONE candidate per invocation and tries to **disprove** it. Confirms only with concrete `file:line` evidence.
3. **Coordinator**: Orchestrates subagents via Task tool fan-out, emits a JSON array to stdout. **Never posts to GitHub.**

### Code layer (`src/`, all tested)

Deterministic, pure-function pipeline — no network calls. Stages compose in `runPipeline()`:

```
Verifier JSON → parse (schema.ts) → pre-filter (prefilters.ts)
  → policy (policy.ts) → fingerprint (fingerprint.ts)
  → position map (diffmap.ts) → reconcile (reconcile.ts)
  → ReconcilePlan { create, update, resolve, suppressed }
```

## Key Invariants

- **Two passes, never one.** Generation and verification must stay separate — the noise control depends on it.
- **Coordinator does not post.** It only emits JSON; all posting is deterministic code.
- **Fingerprint excludes line number** — `hash(file + category + normalizedClaim)`. Findings survive line drift between pushes. Reconciliation keys on this.
- **Verifier emits severity + confidence; `policy.ts` decides the cutoff.** Retune thresholds without touching prompts.
- **Subagents, not agent teams.** Use Task tool fan-out. No TeamCreate/SendMessage.

## Data Types (`src/types.ts`)

- `Candidate` — generation output (file, line, category, claim, severity)
- `VerifiedFinding` — verification output (verdict, confidence, evidence, suggestion)
- `PostableFinding` — after policy + fingerprint + position mapping
- `PriorComment` — prior-run state (commentId, fingerprint, state: open/resolved/dismissed)

## Testing Strategy

Code layer has full unit test coverage. Prompt layer has **no** unit tests by design — model judgment is an eval problem, not a unit-test problem. Build a labeled corpus of `(diff → expected findings)` and score verifier precision/recall.

Diff position math (`diffmap.ts`) is the classic footgun — position is the offset from the first hunk header counting every line, not the file line number. Heavily tested for this reason.

## Build Plan

See `AGENT_HANDOFF.md` for the ordered milestone plan (M1–M7) covering: action metadata, posting entrypoint, prior-state retrieval, config file, eval harness, CI/release, and fork safety.

## Design Reference

`DESIGN.md` is the architectural source of truth. Read the prompt/code boundary table before making changes.
