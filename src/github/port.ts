// The port that decouples the review orchestration from the GitHub API.
// `executeReview()` depends only on this interface, so it can be tested against
// an in-memory fake. `octokit-adapter.ts` is the real implementation.

import type { ReviewCommentPayload } from "./payload.js";
import type { RawComment } from "./prior-state.js";

export interface GitHubPort {
  /** Changed files in the PR, with their unified-diff patch (absent for binary). */
  getPrFiles(): Promise<{ filename: string; patch?: string }[]>;
  /** This bot's existing review comments (bodies are marker-parsed by the caller). */
  listReviewComments(): Promise<RawComment[]>;
  /** Comment ids the PR author reacted to with 👎. */
  getDownvotedCommentIds(): Promise<Set<number>>;
  /** Comment ids whose review thread is resolved. */
  getResolvedThreadCommentIds(): Promise<Set<number>>;
  /** Post a new inline review comment; returns the new comment id. */
  createReviewComment(payload: ReviewCommentPayload): Promise<number>;
  /** Edit an existing comment's body in place. */
  updateComment(commentId: number, body: string): Promise<void>;
  /** Resolve the review thread for a comment whose finding no longer recurs. */
  resolveThread(commentId: number): Promise<void>;
  /** Create or update the single summary comment. */
  upsertSummary(body: string): Promise<void>;
}
