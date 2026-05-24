// Reconcile this run's findings against what was posted on previous pushes.
// Decisions are pure functions of (current findings, prior comment state), so
// they are fully unit-testable without touching the GitHub API. The caller
// executes the resulting actions.

import type { PostableFinding, PriorComment } from "./types.js";

export interface ReconcilePlan {
  /** New findings with no prior comment — post fresh. */
  create: PostableFinding[];
  /** Findings that match an existing open/resolved comment — update in place. */
  update: { finding: PostableFinding; commentId: number }[];
  /** Comment ids whose finding is gone this run — resolve the thread. */
  resolve: number[];
  /** Findings suppressed because the user previously 👎'd that fingerprint. */
  suppressed: PostableFinding[];
}

export function reconcile(
  current: PostableFinding[],
  prior: PriorComment[],
): ReconcilePlan {
  const priorByFp = new Map<string, PriorComment>();
  for (const p of prior) priorByFp.set(p.fingerprint, p);

  const plan: ReconcilePlan = {
    create: [],
    update: [],
    resolve: [],
    suppressed: [],
  };

  const currentFps = new Set<string>();

  for (const f of current) {
    currentFps.add(f.fingerprint);
    const p = priorByFp.get(f.fingerprint);
    if (p && p.state === "dismissed") {
      // The author rejected this finding before; never re-post it.
      plan.suppressed.push(f);
      continue;
    }
    if (p) {
      plan.update.push({ finding: f, commentId: p.commentId });
    } else {
      plan.create.push(f);
    }
  }

  // Any prior OPEN comment whose finding didn't recur this run is now fixed.
  for (const p of prior) {
    if (p.state === "open" && !currentFps.has(p.fingerprint)) {
      plan.resolve.push(p.commentId);
    }
  }

  return plan;
}
