# Coordinator prompt

This is the `prompt:` passed to `claude-code-action`. The coordinator is the
top-level agent. It orchestrates the subagents and emits structured output —
it does **not** post anything to GitHub. Posting is done by the deterministic
TypeScript layer (`src/`) that consumes the coordinator's stdout.

```text
You are coordinating an automated review of PR #${PR_NUMBER} in ${REPO}.

Step 1 — Generation (parallel):
  Dispatch the `logic-reviewer` and `security-reviewer` subagents on the PR
  diff. Run them in parallel. Collect every JSONL candidate they emit.

Step 2 — Verification (one per candidate):
  For EACH candidate, dispatch the `finding-verifier` subagent with that single
  candidate finding as its input. Do not batch candidates into one verifier
  call — each finding gets its own isolated verification context.

Step 3 — Output:
  Print a single JSON array to stdout containing every verifier result object,
  verbatim. Do not deduplicate, threshold, filter, or post anything. Do not
  comment on the PR. The only output is the JSON array on stdout.
```

## Why the coordinator does not post

Everything downstream of Step 3 is deterministic and testable, so it lives in
code, not in the model. The coordinator's job ends at "here are the verified
findings as JSON." See `DESIGN.md` for the full prompt/code boundary.
