# claude-code-review

A GitHub Action that performs **generate-then-verify** AI code review on pull
requests. Posts line-level comments with applyable suggestions at a tunable
noise level, using your own API key.

Built on [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) —
self-hosted, pay-your-own-tokens, not the managed Code Review service.

## How it works

Recall and precision are split into two passes:

1. **Generation** (recall-biased) — specialist reviewers (logic, security)
   surface anything that *might* be wrong. Deliberately over-eager; false
   positives are cheap because they get filtered next.
2. **Verification** (precision-biased) — each candidate is handed to a
   verifier whose job is to *disprove* it. A finding survives only if the
   verifier can cite concrete `file:line` evidence that the bug is real and
   unhandled.

After verification, a deterministic TypeScript pipeline filters by skip-globs,
applies confidence thresholds and a nit cap, maps findings to GitHub diff
positions, and reconciles against prior comments to produce
create/update/resolve/suppress actions.

```
PR diff
  │
  ▼
[generation]  logic-reviewer + security-reviewer  → JSONL candidates
  │
  ▼
[verification]  finding-verifier × N (one per candidate) → JSON verdicts
  │
  ▼
[pre-filter]  skip-globs, outside-diff, dedupe
  │
  ▼
[policy]  confidence thresholds, severity gate, nit cap
  │
  ▼
[reconcile]  create / update / resolve / suppress
  │
  ▼
GitHub review comments + check-run summary
```

## Usage

```yaml
# .github/workflows/claude-code-review.yml
name: Claude Code Review

on:
  pull_request:
    types: [opened, synchronize, ready_for_review]

permissions:
  contents: read
  pull-requests: write
  id-token: write

jobs:
  review:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: phatblat/claude-code-review@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Tuning

The noise dial has two layers:

### Prompt layer

Add/remove reviewer agents in `.claude/agents/`, adjust the verifier's evidence
bar, or inject a `REVIEW.md` instruction block into the coordinator prompt.

### Policy layer (`policy.ts`)

Deterministic, testable, no prompt changes needed:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `thresholds.important` | `0.50` | Min confidence to post important findings |
| `thresholds.nit` | `0.85` | Min confidence to post nits |
| `maxNits` | `5` | Nit cap — extras become "plus N similar" in summary |
| `postPreExisting` | `false` | Whether to post bugs already on the base branch |

Raise the nit threshold or lower `maxNits` if reviews feel chatty. Lower the
important threshold if real bugs are slipping through.

### Config file

Drop a `.github/claude-code-review.yml` in your repo to set defaults without
changing the workflow:

```yaml
thresholds:
  important: 0.6
  nit: 0.9
max_nits: 3
post_pre_existing: false
skip_globs:
  - "src/gen/**"
  - "**/*.lock"
  - "vendor/**"
```

Action inputs override config file values; config file values override defaults.

## Fork safety

The example workflow uses `pull_request` (not `pull_request_target`), which
means forked PRs **cannot access your secrets**. This is the safe default.

If you switch to `pull_request_target` to allow reviews on fork PRs, be aware
that the PR's code runs with access to your repository secrets. Only do this
if you understand the implications — see GitHub's
[security hardening guide](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#understanding-the-risk-of-script-injections).

Other safety defaults:
- **Permissions**: `contents: read`, `pull-requests: write` — least privilege
- **Draft PRs**: Skipped (`if: github.event.pull_request.draft == false`)
- **Binary files**: Handled gracefully — files without a patch are skipped
  for inline comments and reflected only in the summary
- **Large diffs**: The pipeline processes whatever the GitHub API returns;
  findings on lines outside the diff are filtered out, not errored

## Development

```bash
just deps       # mise install + npm install
just test       # vitest — 67 tests, ~2s, no network
just typecheck  # tsc --noEmit (strict mode)
just lint       # static checks
just check      # lint + tests
just eval       # run eval harness against labeled fixtures
just build      # esbuild → dist/main.js
```

```bash
See [DESIGN.md](./DESIGN.md) for the full architecture and the prompt/code
boundary table.

## License

[Apache 2.0](./LICENSE) — Copyright 2026 Ben Chatelain
