import { describe, it, expect } from "vitest";
import { embedMarker, parseMarker, isSummaryComment, SUMMARY_MARKER } from "../src/github/marker.js";
import { renderCommentBody, renderSummary } from "../src/github/comment-format.js";
import { toReviewComment, canPostInline } from "../src/github/payload.js";
import { derivePriorComments } from "../src/github/prior-state.js";
import { parsePolicy, parseSkipGlobs } from "../src/config.js";
import { DEFAULT_POLICY } from "../src/policy.js";
import type { PostableFinding } from "../src/types.js";

function pf(over: Partial<PostableFinding> = {}): PostableFinding {
  return {
    verdict: "confirmed",
    file: "app.ts",
    line: 12,
    category: "logic",
    severity: "important",
    confidence: 0.9,
    evidence: "app.ts:12 dereferences user before the guard at app.ts:4",
    suggestion: null,
    fingerprint: "abcd1234",
    position: 5,
    ...over,
  };
}

describe("marker", () => {
  it("round-trips a fingerprint", () => {
    expect(parseMarker(embedMarker("deadbeef"))).toBe("deadbeef");
  });
  it("finds a marker embedded in a larger body", () => {
    const body = `some text\n\n${embedMarker("00ff00ff")}\nmore`;
    expect(parseMarker(body)).toBe("00ff00ff");
  });
  it("returns null when no marker present", () => {
    expect(parseMarker("just a normal comment")).toBeNull();
  });
  it("detects the summary marker", () => {
    expect(isSummaryComment(`x ${SUMMARY_MARKER} y`)).toBe(true);
    expect(isSummaryComment("no marker")).toBe(false);
  });
});

describe("renderCommentBody", () => {
  it("includes badge, evidence, and the fingerprint marker", () => {
    const body = renderCommentBody(pf());
    expect(body).toContain("Important");
    expect(body).toContain("dereferences user");
    expect(parseMarker(body)).toBe("abcd1234");
  });
  it("renders a suggestion block only when a suggestion is present", () => {
    expect(renderCommentBody(pf({ suggestion: null }))).not.toContain("```suggestion");
    const withFix = renderCommentBody(pf({ suggestion: "if (!user) return;" }));
    expect(withFix).toContain("```suggestion");
    expect(withFix).toContain("if (!user) return;");
  });
  it("treats an empty-string suggestion as no suggestion", () => {
    expect(renderCommentBody(pf({ suggestion: "" }))).not.toContain("```suggestion");
  });
});

describe("renderSummary", () => {
  it("shows tallies and the nit overflow", () => {
    const summary = { important: 2, nit: 5, preExisting: 1, droppedByThreshold: 3, rejected: 4 };
    const text = renderSummary(summary, 7);
    expect(text).toContain(SUMMARY_MARKER);
    expect(text).toContain("Important: **2**");
    expect(text).toContain("plus 7 more nit");
    expect(text).toContain("4 rejected");
  });
});

describe("payload", () => {
  it("builds a line+side RIGHT comment payload", () => {
    const p = toReviewComment(pf({ file: "x.ts", line: 9 }));
    expect(p).toMatchObject({ path: "x.ts", line: 9, side: "RIGHT" });
    expect(parseMarker(p.body)).toBe("abcd1234");
  });
  it("gates inline posting on a non-null diff position", () => {
    expect(canPostInline(pf({ position: 5 }))).toBe(true);
    expect(canPostInline(pf({ position: null }))).toBe(false);
  });
});

describe("derivePriorComments", () => {
  it("ignores comments without our marker", () => {
    const comments = [{ id: 1, body: "a human comment" }];
    expect(derivePriorComments(comments, new Set(), new Set())).toEqual([]);
  });
  it("classifies open / resolved / dismissed", () => {
    const comments = [
      { id: 1, body: embedMarker("aaa") },
      { id: 2, body: embedMarker("bbb") },
      { id: 3, body: embedMarker("ccc") },
    ];
    const prior = derivePriorComments(comments, new Set([3]), new Set([2]));
    expect(prior).toEqual([
      { fingerprint: "aaa", commentId: 1, state: "open" },
      { fingerprint: "bbb", commentId: 2, state: "resolved" },
      { fingerprint: "ccc", commentId: 3, state: "dismissed" },
    ]);
  });
  it("lets dismissal win over resolution", () => {
    const comments = [{ id: 9, body: embedMarker("abcabc") }];
    const prior = derivePriorComments(comments, new Set([9]), new Set([9]));
    expect(prior[0].state).toBe("dismissed");
  });
});

describe("config", () => {
  it("uses defaults when env is empty", () => {
    expect(parsePolicy({})).toEqual(DEFAULT_POLICY);
  });
  it("applies overrides and ignores garbage", () => {
    const cfg = parsePolicy({
      CCR_POST_PRE_EXISTING: "true",
      CCR_IMPORTANT_THRESHOLD: "0.7",
      CCR_NIT_THRESHOLD: "not-a-number",
      CCR_MAX_NITS: "3",
    });
    expect(cfg.postPreExisting).toBe(true);
    expect(cfg.thresholds.important).toBe(0.7);
    expect(cfg.thresholds.nit).toBe(DEFAULT_POLICY.thresholds.nit); // garbage -> default
    expect(cfg.maxNits).toBe(3);
  });
  it("parses comma-separated skip globs", () => {
    expect(parseSkipGlobs(" src/gen/** , **/*.lock ")).toEqual(["src/gen/**", "**/*.lock"]);
    expect(parseSkipGlobs(undefined)).toEqual([]);
  });
});
