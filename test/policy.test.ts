import { describe, it, expect } from "vitest";
import { applyPolicy, DEFAULT_POLICY, type PolicyConfig } from "../src/policy.js";
import type { VerifiedFinding } from "../src/types.js";

function f(over: Partial<VerifiedFinding>): VerifiedFinding {
  return {
    verdict: "confirmed",
    file: "a.ts",
    line: 1,
    category: "logic",
    severity: "important",
    confidence: 0.9,
    evidence: "ev",
    suggestion: null,
    ...over,
  };
}

describe("applyPolicy", () => {
  it("drops rejected findings", () => {
    const res = applyPolicy([f({ verdict: "rejected" })]);
    expect(res.post).toHaveLength(0);
    expect(res.summary.rejected).toBe(1);
  });

  it("drops pre_existing by default but counts them", () => {
    const res = applyPolicy([f({ verdict: "pre_existing" })]);
    expect(res.post).toHaveLength(0);
    expect(res.summary.preExisting).toBe(1);
  });

  it("posts pre_existing when configured", () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, postPreExisting: true };
    const res = applyPolicy([f({ verdict: "pre_existing", confidence: 0.9 })], cfg);
    expect(res.post).toHaveLength(1);
  });

  it("applies per-severity confidence thresholds", () => {
    // nit threshold is 0.85 by default; important is 0.5
    const res = applyPolicy([
      f({ severity: "nit", confidence: 0.8 }), // below nit threshold -> dropped
      f({ severity: "nit", confidence: 0.9 }), // kept
      f({ severity: "important", confidence: 0.55 }), // kept
    ]);
    expect(res.post).toHaveLength(2);
    expect(res.summary.droppedByThreshold).toBe(1);
  });

  it("caps nits and reports the overflow count", () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, maxNits: 2 };
    const nits = [0.9, 0.91, 0.92, 0.93].map((c) => f({ severity: "nit", confidence: c }));
    const res = applyPolicy(nits, cfg);
    expect(res.post).toHaveLength(2);
    expect(res.extraNitCount).toBe(2);
    expect(res.summary.nit).toBe(2);
  });

  it("ranks important before nit, then by confidence", () => {
    const res = applyPolicy([
      f({ severity: "nit", confidence: 0.99, line: 1 }),
      f({ severity: "important", confidence: 0.6, line: 2 }),
      f({ severity: "important", confidence: 0.95, line: 3 }),
    ]);
    expect(res.post.map((x) => x.line)).toEqual([3, 2, 1]);
  });

  it("does not let nits crowd out important findings (cap is nit-only)", () => {
    const cfg: PolicyConfig = { ...DEFAULT_POLICY, maxNits: 1 };
    const res = applyPolicy([
      f({ severity: "important", confidence: 0.9, line: 1 }),
      f({ severity: "important", confidence: 0.9, line: 2 }),
      f({ severity: "nit", confidence: 0.9, line: 3 }),
      f({ severity: "nit", confidence: 0.9, line: 4 }),
    ], cfg);
    expect(res.summary.important).toBe(2);
    expect(res.summary.nit).toBe(1);
    expect(res.extraNitCount).toBe(1);
  });
});
