// The only non-pure file in the posting layer. Implements GitHubPort against
// the GitHub API. REST methods are implemented; the two GraphQL-backed methods
// (👎 dismissals, resolved threads) are STUBBED and must be completed after
// confirming the current GraphQL schema — see AGENT_HANDOFF.md §5C. Until then
// the fix-rate loop degrades gracefully: nothing is suppressed or auto-resolved,
// but create/update still work.

import * as github from "@actions/github";
import * as core from "@actions/core";
import type { GitHubPort } from "./port.js";
import type { ReviewCommentPayload } from "./payload.js";
import type { RawComment } from "./prior-state.js";
import { isSummaryComment } from "./marker.js";

type Octokit = ReturnType<typeof github.getOctokit>;

export interface RepoContext {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
}

export class OctokitGitHubPort implements GitHubPort {
  constructor(
    private readonly octokit: Octokit,
    private readonly ctx: RepoContext,
  ) {}

  async getPrFiles(): Promise<{ filename: string; patch?: string }[]> {
    const files = await this.octokit.paginate(this.octokit.rest.pulls.listFiles, {
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      pull_number: this.ctx.prNumber,
      per_page: 100,
    });
    return files.map((f) => ({ filename: f.filename, patch: f.patch }));
  }

  async listReviewComments(): Promise<RawComment[]> {
    const comments = await this.octokit.paginate(this.octokit.rest.pulls.listReviewComments, {
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      pull_number: this.ctx.prNumber,
      per_page: 100,
    });
    return comments.map((c) => ({ id: c.id, body: c.body ?? "" }));
  }

  // STUB — requires GraphQL reactions query. See AGENT_HANDOFF.md §5C.
  // Implement by querying reactions on each review comment and collecting the
  // ids where the PR author reacted with THUMBS_DOWN.
  async getDownvotedCommentIds(): Promise<Set<number>> {
    core.warning("getDownvotedCommentIds is stubbed; 👎 suppression is inactive.");
    return new Set<number>();
  }

  // STUB — requires GraphQL pullRequest.reviewThreads { isResolved, comments }.
  // See AGENT_HANDOFF.md §5C. Map resolved threads back to their comment ids.
  async getResolvedThreadCommentIds(): Promise<Set<number>> {
    core.warning("getResolvedThreadCommentIds is stubbed; auto-resolve is inactive.");
    return new Set<number>();
  }

  async createReviewComment(payload: ReviewCommentPayload): Promise<number> {
    const res = await this.octokit.rest.pulls.createReviewComment({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      pull_number: this.ctx.prNumber,
      commit_id: this.ctx.headSha,
      path: payload.path,
      line: payload.line,
      side: payload.side,
      body: payload.body,
    });
    return res.data.id;
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.pulls.updateReviewComment({
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      comment_id: commentId,
      body,
    });
  }

  // STUB — thread resolution is a GraphQL mutation (resolveReviewThread) keyed
  // by thread id, not comment id. See AGENT_HANDOFF.md §5C.
  async resolveThread(commentId: number): Promise<void> {
    core.warning(`resolveThread(${commentId}) is stubbed; thread not resolved.`);
  }

  async upsertSummary(body: string): Promise<void> {
    const existing = await this.octokit.paginate(this.octokit.rest.issues.listComments, {
      owner: this.ctx.owner,
      repo: this.ctx.repo,
      issue_number: this.ctx.prNumber,
      per_page: 100,
    });
    const prior = existing.find((c) => isSummaryComment(c.body ?? ""));
    if (prior) {
      await this.octokit.rest.issues.updateComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        comment_id: prior.id,
        body,
      });
    } else {
      await this.octokit.rest.issues.createComment({
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        issue_number: this.ctx.prNumber,
        body,
      });
    }
  }
}
