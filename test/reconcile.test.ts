import { describe, it, expect } from "vitest";
import { reconcile } from "../src/reconcile.js";
import type { PostableFinding, PriorComment } from "../src/types.js";

function pf(fp: string, over: Partial<PostableFinding> = {}): PostableFinding {
  return {
    verdict: "confirmed",
    file: "a.ts",
    line: 1,
    category: "logic",
    severity: "important",
    confidence: 0.9,
    evidence: "ev",
    suggestion: null,
    fingerprint: fp,
    position: 1,
    ...over,
  };
}

describe("reconcile", () => {
  it("creates findings with no prior comment", () => {
    const plan = reconcile([pf("aaa"), pf("bbb")], []);
    expect(plan.create).toHaveLength(2);
    expect(plan.update).toHaveLength(0);
    expect(plan.resolve).toHaveLength(0);
  });

  it("updates a finding that matches an open prior comment", () => {
    const prior: PriorComment[] = [{ fingerprint: "aaa", commentId: 100, state: "open" }];
    const plan = reconcile([pf("aaa")], prior);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toEqual([{ finding: pf("aaa"), commentId: 100 }]);
  });

  it("suppresses a finding the author previously dismissed (👎)", () => {
    const prior: PriorComment[] = [{ fingerprint: "aaa", commentId: 100, state: "dismissed" }];
    const plan = reconcile([pf("aaa")], prior);
    expect(plan.suppressed.map((f) => f.fingerprint)).toEqual(["aaa"]);
    expect(plan.create).toHaveLength(0);
    expect(plan.update).toHaveLength(0);
  });

  it("resolves an open prior comment whose finding is gone this run", () => {
    const prior: PriorComment[] = [{ fingerprint: "gone", commentId: 200, state: "open" }];
    const plan = reconcile([pf("aaa")], prior);
    expect(plan.create.map((f) => f.fingerprint)).toEqual(["aaa"]);
    expect(plan.resolve).toEqual([200]);
  });

  it("does not resolve already-resolved or dismissed prior comments", () => {
    const prior: PriorComment[] = [
      { fingerprint: "x", commentId: 1, state: "resolved" },
      { fingerprint: "y", commentId: 2, state: "dismissed" },
    ];
    const plan = reconcile([], prior);
    expect(plan.resolve).toEqual([]);
  });

  it("handles the full mix in one run", () => {
    const current = [pf("keep"), pf("new")];
    const prior: PriorComment[] = [
      { fingerprint: "keep", commentId: 10, state: "open" }, // -> update
      { fingerprint: "fixed", commentId: 11, state: "open" }, // -> resolve
      { fingerprint: "hated", commentId: 12, state: "dismissed" }, // not in current, ignored
    ];
    const plan = reconcile(current, prior);
    expect(plan.create.map((f) => f.fingerprint)).toEqual(["new"]);
    expect(plan.update.map((u) => u.commentId)).toEqual([10]);
    expect(plan.resolve).toEqual([11]);
    expect(plan.suppressed).toHaveLength(0);
  });
});
