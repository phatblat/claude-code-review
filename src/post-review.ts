// The review orchestration. Depends only on a GitHubPort, so it runs against an
// in-memory fake in tests. All judgment was done by the model upstream; all
// determinism lives in runPipeline() and the pure github/* helpers. This file
// is just the sequence of port calls that executes the reconcile plan.

import { runPipeline, type PipelineOutput } from "./index.js";
import { derivePriorComments } from "./github/prior-state.js";
import { toReviewComment, canPostInline } from "./github/payload.js";
import {
  renderCommentBody,
  renderSummary,
  type ReviewMetrics,
} from "./github/comment-format.js";
import type { GitHubPort } from "./github/port.js";
import type { PolicyConfig } from "./policy.js";

export interface ExecuteOptions {
  verifierStdout: string;
  skipGlobs?: string[];
  policy?: PolicyConfig;
  metrics?: ReviewMetrics;
}

export interface ExecuteResult {
  created: number;
  updated: number;
  resolved: number;
  suppressed: number;
  notInlineable: number;
  summary: PipelineOutput["summary"];
  parseErrors: string[];
}

export async function executeReview(
  port: GitHubPort,
  opts: ExecuteOptions
): Promise<ExecuteResult> {
  const [files, rawComments, downvoted, resolvedThreads] = await Promise.all([
    port.getPrFiles().catch((e) => {
      throw new Error(`getPrFiles: ${e.message}`);
    }),
    port.listReviewComments().catch((e) => {
      throw new Error(`listReviewComments: ${e.message}`);
    }),
    port.getDownvotedCommentIds(),
    port.getResolvedThreadCommentIds(),
  ]);

  const prior = derivePriorComments(rawComments, downvoted, resolvedThreads);

  const { plan, extraNitCount, summary, parseErrors } = runPipeline({
    verifierStdout: opts.verifierStdout,
    files,
    prior,
    skipGlobs: opts.skipGlobs,
    policy: opts.policy,
  });

  let created = 0;
  let notInlineable = 0;
  for (const finding of plan.create) {
    if (!canPostInline(finding)) {
      notInlineable++; // counted in summary, surfaced there instead of inline
      continue;
    }
    await port.createReviewComment(toReviewComment(finding));
    created++;
  }

  for (const { finding, commentId } of plan.update) {
    await port.updateComment(commentId, renderCommentBody(finding));
  }

  for (const commentId of plan.resolve) {
    await port.resolveThread(commentId);
  }

  const metrics: ReviewMetrics = {
    ...opts.metrics,
    findingCount: plan.create.length + plan.update.length,
  };
  await port.upsertSummary(renderSummary(summary, extraNitCount, metrics));

  return {
    created,
    updated: plan.update.length,
    resolved: plan.resolve.length,
    suppressed: plan.suppressed.length,
    notInlineable,
    summary,
    parseErrors,
  };
}
