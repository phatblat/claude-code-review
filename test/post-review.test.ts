import { describe, it, expect } from "vitest";
import { executeReview } from "../src/post-review.js";
import type { GitHubPort } from "../src/github/port.js";
import type { ReviewCommentPayload } from "../src/github/payload.js";
import type { RawComment } from "../src/github/prior-state.js";
import { embedMarker } from "../src/github/marker.js";
import { fingerprint } from "../src/fingerprint.js";

const patch = ["@@ -1,3 +1,4 @@", " a", "+b", "+c", " d"].join("\n");
// added new-side lines: 2 (b), 3 (c)

/** Records every call so the test can assert on the executed plan. */
class FakeGitHubPort implements GitHubPort {
  created: ReviewCommentPayload[] = [];
  updated: { id: number; body: string }[] = [];
  resolved: number[] = [];
  summaries: string[] = [];
  private nextId = 1000;

  constructor(
    private readonly comments: RawComment[] = [],
    private readonly downvoted: Set<number> = new Set(),
    private readonly resolvedThreads: Set<number> = new Set()
  ) {}

  async getPrFiles() {
    return [{ filename: "app.ts", patch }];
  }
  async listReviewComments() {
    return this.comments;
  }
  async getDownvotedCommentIds() {
    return this.downvoted;
  }
  async getResolvedThreadCommentIds() {
    return this.resolvedThreads;
  }
  async createReviewComment(payload: ReviewCommentPayload) {
    this.created.push(payload);
    return this.nextId++;
  }
  async updateComment(commentId: number, body: string) {
    this.updated.push({ id: commentId, body });
  }
  async resolveThread(commentId: number) {
    this.resolved.push(commentId);
  }
  async upsertSummary(body: string) {
    this.summaries.push(body);
  }
}

function finding(file: string, line: number, evidence: string) {
  return {
    verdict: "confirmed",
    file,
    line,
    category: "logic",
    severity: "important",
    confidence: 0.9,
    evidence,
    suggestion: null,
  };
}

describe("executeReview", () => {
  it("creates new findings, resolves gone ones, suppresses dismissed ones", async () => {
    const fpDismiss = fingerprint("app.ts", "logic", "E-dismiss");
    const fpGone = fingerprint("x.ts", "logic", "gone");

    const port = new FakeGitHubPort(
      [
        { id: 12, nodeId: "n12", body: `old\n${embedMarker(fpDismiss)}` }, // dismissed below
        { id: 13, nodeId: "n13", body: `old\n${embedMarker(fpGone)}` }, // open, not in this run -> resolve
      ],
      new Set([12]), // 12 was 👎'd
      new Set() // none resolved yet
    );

    const verifier = JSON.stringify([
      finding("app.ts", 2, "E-new"), // brand new, in diff -> create
      { ...finding("app.ts", 3, "E-dismiss") }, // matches dismissed fp -> suppress
      finding("app.ts", 99, "E-offdiff"), // not in diff -> dropped before posting
    ]);

    const result = await executeReview(port, { verifierStdout: verifier });

    // One created (the new in-diff finding), with a line+side RIGHT payload.
    expect(port.created).toHaveLength(1);
    expect(port.created[0]).toMatchObject({
      path: "app.ts",
      line: 2,
      side: "RIGHT",
    });

    // The dismissed finding was suppressed, not posted.
    expect(result.suppressed).toBe(1);
    expect(port.created.some((c) => c.body.includes("E-dismiss"))).toBe(false);

    // The previously-open finding that didn't recur got resolved.
    expect(port.resolved).toEqual([13]);

    // Summary always upserted exactly once.
    expect(port.summaries).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.resolved).toBe(1);
  });

  it("updates instead of duplicating when a finding recurs", async () => {
    const fp = fingerprint("app.ts", "logic", "E-recurring");
    const port = new FakeGitHubPort(
      [{ id: 42, nodeId: "n42", body: embedMarker(fp) }],
      new Set(),
      new Set()
    );

    const verifier = JSON.stringify([finding("app.ts", 2, "E-recurring")]);
    const result = await executeReview(port, { verifierStdout: verifier });

    expect(port.created).toHaveLength(0);
    expect(port.updated).toEqual([
      { id: 42, body: expect.stringContaining("E-recurring") },
    ]);
    expect(result.updated).toBe(1);
  });
});
