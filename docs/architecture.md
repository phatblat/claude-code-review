# Architecture

## Pipeline Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GitHub Actions Workflow                       │
│                 .github/workflows/*.yml                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                  Composite Action (action.yml)             │  │
│  │                                                           │  │
│  │  ┌─────────────────────┐  ┌─────────────────────┐        │  │
│  │  │   Step 1: logic      │  │   Step 2: security   │        │  │
│  │  │   claude-code-action │  │   claude-code-action │        │  │
│  │  │                     │  │                     │        │  │
│  │  │  ┌───────────────┐  │  │  ┌───────────────┐  │        │  │
│  │  │  │ Logic Reviewer │  │  │  │Security Review│  │        │  │
│  │  │  │   Session      │  │  │  │   Session     │  │        │  │
│  │  │  │               │  │  │  │               │  │        │  │
│  │  │  │  Read → Grep  │  │  │  │  Read → Grep  │  │        │  │
│  │  │  │  → Glob       │  │  │  │  → Glob       │  │        │  │
│  │  │  │               │  │  │  │               │  │        │  │
│  │  │  │  Output: JSONL │  │  │  │  Output: JSONL │  │        │  │
│  │  │  │  candidates   │  │  │  │  candidates   │  │        │  │
│  │  │  └───────────────┘  │  │  └───────────────┘  │        │  │
│  │  └──────────┬──────────┘  └──────────┬──────────┘        │  │
│  │             │                        │                    │  │
│  │             ▼                        ▼                    │  │
│  │  ┌──────────────────────────────────────────────┐        │  │
│  │  │  Step 3: combine (node dist/main.cjs)         │        │  │
│  │  │  Extract JSONL from execution transcripts     │        │  │
│  │  │  Output: candidate_count, candidates          │        │  │
│  │  └────────────────────┬─────────────────────────┘        │  │
│  │                       │                                   │  │
│  │                       ▼                                   │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Step 4: verify (claude-code-action)                │  │  │
│  │  │                                                    │  │  │
│  │  │  ┌──────────────────────────────────────────────┐  │  │  │
│  │  │  │         Verification Coordinator              │  │  │  │
│  │  │  │                                              │  │  │  │
│  │  │  │   For each candidate, dispatch via Task:     │  │  │  │
│  │  │  │                                              │  │  │  │
│  │  │  │   ┌──────────┐ ┌──────────┐ ┌──────────┐    │  │  │  │
│  │  │  │   │ Verifier │ │ Verifier │ │ Verifier │    │  │  │  │
│  │  │  │   │ Subagent │ │ Subagent │ │ Subagent │…   │  │  │  │
│  │  │  │   │          │ │          │ │          │    │  │  │  │
│  │  │  │   │ Read,    │ │ Read,    │ │ Read,    │    │  │  │  │
│  │  │  │   │ Grep,    │ │ Grep,    │ │ Grep,    │    │  │  │  │
│  │  │  │   │ Glob     │ │ Glob     │ │ Glob     │    │  │  │  │
│  │  │  │   │          │ │          │ │          │    │  │  │  │
│  │  │  │   │ Verdict: │ │ Verdict: │ │ Verdict: │    │  │  │  │
│  │  │  │   │ confirm/ │ │ confirm/ │ │ confirm/ │    │  │  │  │
│  │  │  │   │ reject/  │ │ reject/  │ │ reject/  │    │  │  │  │
│  │  │  │   │ pre_exist│ │ pre_exist│ │ pre_exist│    │  │  │  │
│  │  │  │   └──────────┘ └──────────┘ └──────────┘    │  │  │  │
│  │  │  │                                              │  │  │  │
│  │  │  │   Output: JSON array of verified findings    │  │  │  │
│  │  │  └──────────────────────────────────────────────┘  │  │  │
│  │  └────────────────────┬───────────────────────────────┘  │  │
│  │                       │                                   │  │
│  │                       ▼                                   │  │
│  │  ┌────────────────────────────────────────────────────┐  │  │
│  │  │  Step 5: post (node dist/main.cjs)                  │  │  │
│  │  │  Deterministic TypeScript Pipeline                  │  │  │
│  │  │                                                    │  │  │
│  │  │  Verified JSON                                     │  │  │
│  │  │    │                                               │  │  │
│  │  │    ├─→ parseVerdicts()        schema.ts            │  │  │
│  │  │    ├─→ dropSkippedPaths()     prefilters.ts        │  │  │
│  │  │    ├─→ dropOutsideDiff()      prefilters.ts        │  │  │
│  │  │    ├─→ dedupe()               prefilters.ts        │  │  │
│  │  │    ├─→ applyPolicy()          policy.ts            │  │  │
│  │  │    ├─→ fingerprint()          fingerprint.ts       │  │  │
│  │  │    ├─→ positionForLine()      diffmap.ts           │  │  │
│  │  │    ├─→ reconcile()            reconcile.ts         │  │  │
│  │  │    │                                               │  │  │
│  │  │    ▼                                               │  │  │
│  │  │  ReconcilePlan                                     │  │  │
│  │  │    { create, update, resolve, suppressed }         │  │  │
│  │  │    │                                               │  │  │
│  │  │    ├─→ createReviewComment()   octokit REST        │  │  │
│  │  │    ├─→ updateComment()         octokit REST        │  │  │
│  │  │    ├─→ resolveThread()         GraphQL mutation    │  │  │
│  │  │    └─→ upsertSummary()         octokit REST        │  │  │
│  │  │                                                    │  │  │
│  │  └────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Boundary

```
 ╔══════════════════════════════════════════════════════════════╗
 ║  BOUNDARY: Judgment (model) above │ Plumbing (code) below   ║
 ║                                                             ║
 ║  Steps 1–4: Model judgment        Step 5: Deterministic     ║
 ║  • What to flag                   • Parse/validate output   ║
 ║  • Severity/confidence            • Threshold/nit cap       ║
 ║  • Evidence citations             • Diff position math      ║
 ║  • Suggestions                    • Reconcile across pushes ║
 ║  • Confirm/reject verdicts        • Post via GitHub API     ║
 ╚══════════════════════════════════════════════════════════════╝
```

## Sessions

```
 Sessions: 3 claude-code-action calls
 ─────────────────────────────────────
 1. Logic reviewer     (max 8 turns, Read/Grep/Glob)
 2. Security reviewer  (max 8 turns, Read/Grep/Glob)
 3. Verify coordinator (max 20 turns, Read/Grep/Glob/Task)
    └─ N finding-verifier subagents via Task tool
```

Each reviewer runs as a standalone `claude-code-action` step — no coordinator
can re-dispatch them. The verification coordinator only has access to the Task
tool for dispatching `finding-verifier` subagents, one per candidate.

All steps use `continue-on-error: true` so partial results are still posted
if a step hits its turn limit.
