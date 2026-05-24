# Claude Code Review: Generate-Then-Verify Pipeline

## Design document

### Problem

A single-turn reviewer (send the diff, get findings back, post one comment)
is cheap and useful as a preview, but it has no mechanism for controlling
noise. Every plausible-looking concern becomes a comment, and the only knob
is the prompt. The goal of this design is line-level review with applyable
suggestions, at a noise level the team can tune over time, without paying for
the fully managed Code Review service ($15–25/review).

### Core idea

Recall and precision are split into two passes:

1. **Generation pass** (recall-biased). Specialist reviewers each surface
   anything that *might* be wrong in their domain. They are deliberately
   over-eager; a wrong finding here is cheap because it gets filtered next.
2. **Verification pass** (precision-biased). Each candidate is handed to a
   verifier whose job is to *disprove* it. The candidate survives only if the
   verifier can cite concrete `file:line` evidence that the bug is real and
   unhandled.

This is the single most important lever for noise. The generator finds; the
verifier earns the right to post. A finding has to survive an adversary that
is actively trying to dismiss it.

### Pipeline stages

```
PR diff
  │
  ▼
[generation]  logic-reviewer  ┐
              security-reviewer┘  → JSONL candidates  (model, prompt)
  │
  ▼
[pre-filter]  skip-globs, dedupe                       (code, tested)
  │
  ▼
[verification]  finding-verifier × N (one per candidate) → JSON verdicts  (model, prompt)
  │
  ▼
[pre-filter]  drop rejected, drop outside-diff, dedupe (code, tested)
  │
  ▼
[policy]      confidence thresholds, severity gate, nit cap (code, tested)
  │
  ▼
[map]         file:line → GitHub diff position           (code, tested)
  │
  ▼
[reconcile]   create / update / resolve / suppress        (code, tested)
  │
  ▼
GitHub review comments + check-run summary               (code, thin API calls)
```

### The prompt/code boundary

The dividing rule: **judgment about whether code is correct lives in prompts;
anything that must be exact, repeatable, stateful, or testable lives in code.**

| Concern | Lives in | Why |
| --- | --- | --- |
| What each reviewer looks for | prompt (`.claude/agents/*.md`) | domain judgment, no deterministic answer |
| The verifier's disprove-it discipline + evidence bar | prompt | reasoning about code behavior |
| Severity and confidence of a finding | prompt (emitted) | judgment |
| Suggestion text | prompt | judgment |
| Parsing/validating model output | code (`schema.ts`) | must not crash on bad output |
| Skip globs, dedupe, drop-outside-diff | code (`prefilters.ts`) | exact, free, deterministic |
| Confidence cutoff, nit cap, pre-existing policy | code (`policy.ts`) | tunable policy, A/B-able |
| Diff → comment position | code (`diffmap.ts`) | fiddly, high-bug-risk, exact |
| Create/update/resolve/suppress across pushes | code (`reconcile.ts`) | stateful, exact |

The verifier *emits* severity and confidence (judgment); the code *decides*
the cutoff (policy). That split is deliberate: you retune the threshold, the
nit cap, or whether pre-existing bugs post, all without editing a prompt — and
you can prove the policy behaves correctly with unit tests.

### Why subagents, not agent teams

The generation/verification fan-out maps onto Claude Code **subagents** (the
Task tool): a coordinator dispatches specialist reviewers and a per-candidate
verifier, each with its own isolated context and restricted tools. Agent teams
(`TeamCreate`/`SendMessage`/shared task list) are built for parallel
*implementation* with persistent inter-agent coordination — a multi-writer
problem. Review is read-heavy and convergent (gather, filter, post once), so it
needs none of that, and teams add cost and an Opus requirement for coordination
this pipeline doesn't use. Adding a new review dimension is a new markdown file,
not a code change.

### The coordinator does not post

The coordinator's job ends at "here are the verified findings as a JSON array
on stdout." Everything downstream is deterministic, so it runs in the tested
TypeScript layer. This keeps the untestable part (model judgment) small and the
testable part (plumbing) under real assertions. See `prompts/coordinator.md`.

### Data contract

- **Candidate** (generation output, JSONL): `file`, `line`, `category`,
  `claim`, `severity`.
- **VerifiedFinding** (verification output, JSON): `verdict`
  (`confirmed`/`rejected`/`pre_existing`), `file`, `line`, `category`,
  `severity`, `confidence` (0–1), `evidence`, `suggestion` (string or null).

`schema.ts` validates both and drops malformed records rather than failing the
run, because models occasionally emit a stray fence or a half-line.

### Identity and idempotency

A finding's `fingerprint` is `hash(file + category + normalized claim)` — it
deliberately **excludes the line number** so it survives line drift between
pushes. Reconciliation uses the fingerprint to decide, for each finding:
create (new), update (matches an open prior comment), or suppress (the author
previously 👎'd it). Prior open comments whose fingerprint doesn't recur are
resolved — that's the "fix it and the thread closes" behavior. The integration
test asserts a clean re-run produces updates, not duplicates.

### Tuning surface (how you fight noise over time)

Two layers, intentionally:

1. **Prompt** — what gets flagged at all and at what severity. Add a
   `REVIEW.md`-style instruction block, add/remove reviewer agents, or raise
   the verifier's evidence bar.
2. **Policy (`policy.ts`)** — how much of that actually posts. The defaults:

   ```
   important threshold: 0.50    nit threshold: 0.85    maxNits: 5
   postPreExisting: false
   ```

   Raise the nit threshold or lower `maxNits` if reviews feel chatty; lower the
   important threshold if real bugs are slipping through. Because this is code,
   every change is testable and reversible.

The engagement signal that tells you whether you're winning: the **fix rate** —
the fraction of posted findings that get resolved (author addressed it) versus
👎'd or ignored. `reconcile.ts` already distinguishes resolved from dismissed,
so the counts fall out of the data you're already tracking.

### Testing strategy

The prompt/code boundary is also the testing boundary:

- **Code layer → unit tests.** Parsing, globs, thresholds, the nit cap, diff
  position math, and reconciliation all have exact expected outputs. See
  `test/` — 40 cases, runs in ~2s, no network. This is the regression net for
  the parts that actually break.
- **Prompt layer → evals.** You cannot unit-test "does the verifier reject a
  guarded null." Build a labeled corpus of `(diff → expected findings)` and
  score the verifier's reject/confirm accuracy against it. Track that number as
  you change prompts; it's the analogue of the fix rate for the offline loop.

### Cost levers

You pay your own token cost (cents/review on Sonnet for the generation passes),
not the managed premium. Multi-agent fan-out costs more than a single turn, but
you control every dial: model per agent (`model:` in frontmatter — Sonnet for
breadth, escalate only the verifier to Opus if evals justify it), `maxTurns`
per agent, how many specialist reviewers run, and the review trigger (per-push
vs. once vs. manual).

### Build/maintain stance

Most of the intelligence lives in four markdown files and a coordinator prompt
— cheap to iterate, no build step. The only compiled, version-pinned code is
the deterministic posting layer, which is exactly the part that benefits from
types and tests. Distribute the whole thing across repos as a reusable action
(`uses: your-org/ai-review@v1`) so there's one source of truth to fix and tune.

---

## Posting layer (ports & adapters)

The posting layer keeps the same discipline as the core: a small, fully tested
pure center and a thin I/O shell. The orchestration, `executeReview()`, depends
on a `GitHubPort` interface rather than on octokit, so it is exercised in tests
against an in-memory fake port that records every call — a deterministic,
repeatable integration test with no network.

Everything that formats or decides is a pure function:

- **`github/marker.ts`** embeds and parses a hidden `<!-- ccr:fp=… -->`
  fingerprint marker in each comment body. This is how prior comments are
  matched across pushes with no external storage: list the bot's comments, parse
  the markers, reconcile on fingerprint.
- **`github/prior-state.ts`** derives `PriorComment[]` (open / resolved /
  dismissed) from listed comments plus the sets of 👎'd and resolved-thread
  comment ids. Dismissal wins over resolution, so a finding the author rejected
  never resurfaces. Pure given those inputs.
- **`github/comment-format.ts`** renders the comment body (severity badge,
  evidence, optional ` ```suggestion ` block, marker) and the summary comment.
- **`github/payload.ts`** builds the review-comment payload. We post with
  `line` + `side: "RIGHT"` (the modern reviews API), not the deprecated
  `position`. The `position` from `diffmap.ts` is repurposed as the
  "is this line in the diff" gate (`canPostInline`): null position means the
  finding can't be placed inline and is reflected in the summary instead.
- **`config.ts`** parses action inputs (env) into a `PolicyConfig` + skip globs,
  falling back to defaults on anything missing or malformed.

The one non-pure file is **`github/octokit-adapter.ts`**, which implements the
port. Its REST methods (list files, list comments, create, update, summary
upsert) are implemented. The two GraphQL-backed methods — detecting 👎
dismissals and resolved threads — are stubbed and clearly flagged, because they
depend on the current GraphQL schema (see `AGENT_HANDOFF.md` §5C). Until they're
completed the layer degrades gracefully: create/update still work; nothing is
suppressed or auto-resolved. `main.ts` is the action entrypoint that reads env,
builds the adapter, and calls `executeReview()`.

This is the same boundary again: `executeReview()` and every pure helper are
under unit tests; the adapter is the only thing that touches the network and is
the only thing left to verify against live API docs.
