# Build Handoff: `phatblat/claude-code-review`

**Audience:** an AI coding agent picking up an existing seed and shipping a
complete, reusable GitHub Action.

**Mission:** turn the seed in `ai-review/` into a production GitHub Action,
`phatblat/claude-code-review`, that performs **generate-then-verify** AI code
review on pull requests, posts **line-level comments with applyable
suggestions**, and exposes a **tunable noise dial**. It runs on
`anthropics/claude-code-action` (self-hosted, pay-your-own-tokens), not the
managed Code Review service.

**Definition of done:** another repo can add
`uses: phatblat/claude-code-review@v1` to a workflow, set an API key, and get
verified inline review comments that update/resolve across pushes — with the
deterministic core under unit tests and the prompt layer under an eval harness.

---

## 1. What you're starting with

The seed (`ai-review/`) already contains a working, tested core. Treat it as
the foundation; do not rewrite it without cause.

| Path | Status | Notes |
| --- | --- | --- |
| `.claude/agents/logic-reviewer.md` | done | generation pass (correctness) |
| `.claude/agents/security-reviewer.md` | done | generation pass (security) |
| `.claude/agents/finding-verifier.md` | done | verification pass, adversarial + evidence-gated |
| `prompts/coordinator.md` | done | orchestrates subagents, emits JSON, posts nothing |
| `src/types.ts` | done | data contract |
| `src/schema.ts` | done | parse/validate model output, drop-not-crash |
| `src/fingerprint.ts` | done | stable id, excludes line number |
| `src/prefilters.ts` | done | globs, CI-covered, outside-diff, dedupe |
| `src/policy.ts` | done | thresholds, severity gate, nit cap |
| `src/diffmap.ts` | done | file:line → GitHub diff position |
| `src/reconcile.ts` | done | create/update/resolve/suppress |
| `src/index.ts` | done | `runPipeline()` composes all stages |
| `test/*.test.ts` | done | 40 tests, `npm test`, ~2s, no network |
| `.github/workflows/ai-review.yml` | example only | illustrative wiring, not the action itself |

**Read `ai-review/DESIGN.md` in full before writing code.** It defines the
architecture and the prompt/code boundary the whole project is organized
around. The single most important section is the boundary table.

---

## 2. Invariants — do NOT violate these

These are settled design decisions. Changing them means redoing the analysis
in DESIGN.md; only do so with an explicit reason.

1. **Two passes.** Generation is recall-biased (over-eager); verification is
   precision-biased and tries to *disprove* each candidate. Never collapse them
   back into a single turn — that removes the only real noise control.
2. **The coordinator never posts.** It emits a JSON array of verified findings
   to stdout. All posting/filtering/state is deterministic code.
3. **Judgment in prompts, plumbing in code.** Reviewer lenses, the verifier's
   evidence bar, severity, confidence, and suggestion text live in
   `.claude/agents/`. Parsing, globs, thresholds, position math, and
   reconciliation live in `src/` under tests. The verifier *emits* severity +
   confidence; `policy.ts` *decides* the cutoff. Keep that split.
4. **Subagents, not agent teams.** Review is read-heavy and convergent; use the
   Task tool fan-out. Do not introduce TeamCreate/SendMessage.
5. **Fingerprint excludes the line number** so findings survive line drift.
   Reconciliation keys on it. Don't reintroduce line into identity.
6. **Tests for the deterministic layer; evals for the prompt layer.** Don't try
   to unit-test model judgment, and don't ship prompt changes without eval
   scores.
7. **Cost stays in the user's control.** Per-agent model selection, max-turns,
   and trigger cadence are all configurable. Default the breadth reviewers to
   Sonnet; only escalate the verifier to Opus if evals justify it.

---

## 3. Contracts to preserve

The existing tested code is the integration surface. Keep these stable (extend,
don't break):

- **`runPipeline(input: PipelineInput): PipelineOutput`** in `src/index.ts` is
  the pure core. New I/O code calls it; it must remain free of network/side
  effects so the tests stay valid.
- **Data contract** (`src/types.ts`): `Candidate`, `VerifiedFinding`,
  `PostableFinding`, `PriorComment`. If the model output schema changes, update
  `schema.ts` validators and their tests together.
- **`ReconcilePlan`** (`create`/`update`/`resolve`/`suppressed`) is what the
  posting layer consumes. Build the GitHub I/O to execute this plan exactly.

---

## 4. Build plan (ordered milestones)

Each milestone has an acceptance criterion. Keep `npm test` green throughout;
add tests with each milestone.

### M1 — Make it an action  ✅ SEEDED
- `action.yml` exists (composite: runs `claude-code-action`, then
  `node dist/main.js`) with the threshold/nit/skip inputs wired through to env.
- `npm run build` bundles `src/main.ts` → `dist/main.js` via esbuild. **You must
  commit `dist/`** and keep it fresh (M6 adds the CI freshness check).
- **Remaining:** add Bedrock/Vertex/Foundry input alternatives if needed; verify
  the `claude-code-action` output field (§5A) used in `action.yml`.
- **Accept:** a local consumer workflow referencing the action by path runs
  end-to-end against a test PR.

### M2 — Posting entrypoint  ✅ SEEDED
- `executeReview()` (`src/post-review.ts`) reads files + prior state via a
  `GitHubPort`, calls `runPipeline()`, and executes the create/update/resolve/
  suppress plan. It's pure of network and covered by an in-memory-fake test.
- Inline comments use `line` + `side: RIGHT`; ` ```suggestion ` blocks render
  when the verifier supplied a suggestion (`comment-format.ts`). The summary
  comment carries tallies + `extraNitCount` and is upserted each run.
- The octokit adapter (`src/github/octokit-adapter.ts`) implements the REST
  methods. **Remaining:** the two GraphQL methods are stubbed — complete them in
  M3 after verifying the schema (§5C).
- **Accept (met by seed):** confirmed in-diff findings post inline with
  suggestions; rejected/below-threshold/out-of-diff/dismissed findings do not.

### M3 — Prior-state retrieval & idempotency  (partially seeded)
- Seeded: `derivePriorComments()` (pure, tested), the comment marker design
  (`github/marker.ts`), and the REST half of the adapter. **Remaining: the two
  GraphQL methods** (`getDownvotedCommentIds`, `getResolvedThreadCommentIds`,
  plus the `resolveThread` mutation) — currently stubbed. Complete after §5C.
- Implement how `PriorComment[]` is reconstructed each run. Recommended design:
  embed a hidden marker in every posted comment body, e.g.
  `<!-- ccr:fp=<fingerprint> -->`, then on each run list the bot's existing
  review comments, parse markers → `commentId` + `fingerprint`.
- Map comment → state: `dismissed` from a 👎 reaction by the author (GraphQL
  reactions), `resolved` from a resolved review thread (GraphQL), else `open`.
- **Accept:** a re-run with no code change produces `update`, not duplicate
  comments; fixing an issue and pushing resolves its thread; a 👎'd finding is
  suppressed on subsequent runs. (`reconcile.test.ts` already asserts the pure
  logic; add an integration test with a mocked octokit.)

### M4 — Config file
- Support a repo-level config (`.github/claude-code-review.yml` and/or a
  `REVIEW.md` instruction block injected into the coordinator prompt). Map YAML
  → `PolicyConfig` + `skip_globs`. Keep `policy.ts` defaults as the fallback.
- **Accept:** thresholds/nit-cap/skip-globs change behavior with no code edit;
  parsing has unit tests.

### M5 — Eval harness for the prompt layer
- Add `evals/` with a fixture format: `{ diff, expected: VerifiedFinding-ish }`
  cases (true positives, guarded false positives, pre-existing, naming-only
  inferences). Add a scorer that runs the pipeline against each diff and reports
  verifier **precision/recall** and the false-positive rate by class.
- **Accept:** `npm run eval` prints scores; a labeled corpus of ≥15 cases
  exists; CI can run it (allowing for model variance — report, don't hard-fail).

### M6 — CI/release for the action itself
- Workflow: on PR, run `typecheck` + `test` + `build` and fail if `dist/` is
  stale (rebuild-and-diff check). On tag, publish `v1` major-version tag.
- **Accept:** PRs are gated on green tests + fresh `dist/`; `@v1` resolves to
  latest release.

### M7 — Fork safety & permissions
- Default trigger `pull_request` with `permissions: { contents: read,
  pull-requests: write }`. Document the `pull_request_target` secret-exposure
  risk and gate any such usage. Skip drafts. Handle the no-`patch` case (binary
  files, very large diffs) gracefully.
- **Accept:** forked-PR behavior is documented and safe by default; large/binary
  PRs don't crash the run.

---

## 5. Verify against live docs BEFORE coding (do not guess)

These details change and must be confirmed, not assumed. Search/fetch current
docs first.

- **A. `claude-code-action` output mechanism.** Confirm exactly how the
  coordinator's stdout/JSON is exposed to the next step (output name, file path,
  or `${{ steps.<id>.outputs.* }}` field) and how multi-line stdout is handled.
  The seed's example workflow guesses `execution_output`; verify and fix.
  Source: `github.com/anthropics/claude-code-action` README + its solutions
  guide and `code.claude.com/docs/en/github-actions`.
- **B. Subagent invocation in headless/CI mode.** Confirm that
  `.claude/agents/*.md` are discovered when Claude Code runs via the action, how
  the coordinator must reference them, and that the `Task` tool is in
  `--allowedTools`. Source: `code.claude.com/docs/en/sub-agents`.
- **C. Resolving review threads & reading reactions.** These are GraphQL
  (`resolveReviewThread`, reaction queries), not REST. Confirm current schema +
  required scopes. Source: GitHub GraphQL API docs.
- **D. Suggestion block constraints.** Confirm multi-line ` ```suggestion `
  rules and how `start_line`/`line`/`side` interact for the reviews API; decide
  whether to use `position` (the seed's `diffmap.ts`) or the newer `line`+`side`
  fields. Source: GitHub REST "pull request review comments" docs.
- **E. Current model strings.** Confirm the model ids to default to. Source:
  `docs.claude.com` model docs. Do not hard-code a string from memory.

---

## 6. Quality bar

- Keep the deterministic core pure and fully tested; new logic ships with tests.
- I/O code (octokit, action plumbing) gets integration tests against a **mocked**
  octokit — no live network in the suite.
- `npm test`, `npm run typecheck`, and the `dist/`-freshness check must pass in
  CI. Strict TypeScript stays on.
- Prefer extending the existing modules over parallel reimplementations.

---

## 7. Suggested final layout

```
phatblat/claude-code-review/
  action.yml                     # NEW — action metadata + inputs
  .claude/agents/                # from seed (extend as evals demand)
  prompts/coordinator.md         # from seed
  src/                           # from seed + NEW post-review.ts, github/*, config.ts
  dist/                          # NEW — bundled, committed
  evals/                         # NEW — fixtures + scorer
  test/                          # from seed + NEW integration tests
  .github/workflows/
    ci.yml                       # NEW — test/typecheck/build/dist-freshness/release
    example-consumer.yml         # adapted from seed's ai-review.yml
  README.md                      # adapt: how to consume the action
  DESIGN.md                      # from seed — keep as the source of truth
```

---

## 8. One-paragraph orientation (if you read nothing else)

There are two layers. The **prompt layer** (`.claude/agents/` + coordinator) is
model judgment: reviewers over-generate, a verifier adversarially confirms with
evidence, and the coordinator prints verified findings as JSON. The **code
layer** (`src/`, all tested) takes that JSON and deterministically filters,
thresholds, maps to diff positions, and reconciles against prior comments to
produce a create/update/resolve/suppress plan. Your job is to wrap that pure
core in a real GitHub Action: action metadata, the octokit posting glue, prior-
state retrieval via comment markers + GraphQL, a config file, an eval harness
for the prompt layer, and CI/release. Verify the four live-doc items in §5
before writing the glue, and never let the coordinator post or the two passes
collapse into one.
