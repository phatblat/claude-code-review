// The only non-pure file in the posting layer. Implements GitHubPort against
// the GitHub API. REST for file listing, comments, and updates; GraphQL for
// reactions (👎 suppression), review thread state, and thread resolution.

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
  prAuthor: string;
}

export class OctokitGitHubPort implements GitHubPort {
  constructor(
    private readonly octokit: Octokit,
    private readonly ctx: RepoContext
  ) {}

  async getPrFiles(): Promise<{ filename: string; patch?: string }[]> {
    const files = await this.octokit.paginate(
      this.octokit.rest.pulls.listFiles,
      {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        pull_number: this.ctx.prNumber,
        per_page: 100,
      }
    );
    return files.map((f) => ({ filename: f.filename, patch: f.patch }));
  }

  async listReviewComments(): Promise<RawComment[]> {
    const comments = await this.octokit.paginate(
      this.octokit.rest.pulls.listReviewComments,
      {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        pull_number: this.ctx.prNumber,
        per_page: 100,
      }
    );
    return comments.map((c) => ({
      id: c.id,
      nodeId: c.node_id,
      body: c.body ?? "",
    }));
  }

  async getDownvotedCommentIds(): Promise<Set<number>> {
    const comments = await this.listReviewComments();
    if (comments.length === 0) return new Set();

    const BATCH = 50;
    const downvoted = new Set<number>();

    for (let i = 0; i < comments.length; i += BATCH) {
      const batch = comments.slice(i, i + BATCH);
      const query = `query($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on PullRequestReviewComment {
            databaseId
            reactions(first: 100, content: THUMBS_DOWN) {
              nodes { user { login } }
            }
          }
        }
      }`;
      const result: {
        nodes: Array<{
          databaseId?: number;
          reactions?: { nodes: Array<{ user: { login: string } }> };
        } | null>;
      } = await this.octokit.graphql(query, {
        ids: batch.map((c) => c.nodeId),
      });
      for (const node of result.nodes) {
        if (!node?.databaseId || !node.reactions) continue;
        const authorDownvoted = node.reactions.nodes.some(
          (r) => r.user.login === this.ctx.prAuthor
        );
        if (authorDownvoted) downvoted.add(node.databaseId);
      }
    }
    return downvoted;
  }

  private threadIdByCommentId = new Map<number, string>();

  async getResolvedThreadCommentIds(): Promise<Set<number>> {
    const resolved = new Set<number>();
    let cursor: string | null = null;

    do {
      const query = `query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $pr) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isResolved
                comments(first: 1) {
                  nodes { databaseId }
                }
              }
            }
          }
        }
      }`;
      const result: {
        repository: {
          pullRequest: {
            reviewThreads: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              nodes: Array<{
                id: string;
                isResolved: boolean;
                comments: { nodes: Array<{ databaseId: number }> };
              }>;
            };
          };
        };
      } = await this.octokit.graphql(query, {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        pr: this.ctx.prNumber,
        cursor,
      });

      const threads = result.repository.pullRequest.reviewThreads;
      for (const thread of threads.nodes) {
        const commentId = thread.comments.nodes[0]?.databaseId;
        if (!commentId) continue;
        this.threadIdByCommentId.set(commentId, thread.id);
        if (thread.isResolved) resolved.add(commentId);
      }
      cursor = threads.pageInfo.hasNextPage ? threads.pageInfo.endCursor : null;
    } while (cursor);

    return resolved;
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

  async resolveThread(commentId: number): Promise<void> {
    const threadId = this.threadIdByCommentId.get(commentId);
    if (!threadId) {
      core.warning(
        `resolveThread(${commentId}): no thread ID cached; thread not resolved.`
      );
      return;
    }
    const mutation = `mutation($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) {
        thread { id isResolved }
      }
    }`;
    await this.octokit.graphql(mutation, { threadId });
  }

  async upsertSummary(body: string): Promise<void> {
    const existing = await this.octokit.paginate(
      this.octokit.rest.issues.listComments,
      {
        owner: this.ctx.owner,
        repo: this.ctx.repo,
        issue_number: this.ctx.prNumber,
        per_page: 100,
      }
    );
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
