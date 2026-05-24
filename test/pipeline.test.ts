import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/index.js";

const patch = ["@@ -1,3 +1,4 @@", " a", "+b", "+c", " d"].join("\n");
// new-side added lines: 2 (b) and 3 (c); context lines 1 (a) and 4 (d)

describe("runPipeline (integration of deterministic stages)", () => {
  it("turns verifier output into a create plan, dropping noise along the way", () => {
    const verifier = JSON.stringify([
      // confirmed, on a changed line -> should post
      {
        verdict: "confirmed",
        file: "app.ts",
        line: 2,
        category: "logic",
        severity: "important",
        confidence: 0.9,
        evidence: "app.ts:2 uses x before init",
        suggestion: null,
      },
      // rejected -> dropped by policy
      {
        verdict: "rejected",
        file: "app.ts",
        line: 3,
        category: "logic",
        severity: "important",
        confidence: 0.9,
        evidence: "guard exists at app.ts:1",
        suggestion: null,
      },
      // confirmed but on a line not in the diff -> dropped by dropOutsideDiff
      {
        verdict: "confirmed",
        file: "app.ts",
        line: 99,
        category: "logic",
        severity: "important",
        confidence: 0.9,
        evidence: "app.ts:99 ...",
        suggestion: null,
      },
      // confirmed but on a skipped path -> dropped by skip globs
      {
        verdict: "confirmed",
        file: "src/gen/types.ts",
        line: 2,
        category: "logic",
        severity: "important",
        confidence: 0.9,
        evidence: "generated",
        suggestion: null,
      },
    ]);

    const out = runPipeline({
      verifierStdout: verifier,
      files: [
        { filename: "app.ts", patch },
        { filename: "src/gen/types.ts", patch },
      ],
      prior: [],
      skipGlobs: ["src/gen/**"],
    });

    expect(out.parseErrors).toEqual([]);
    expect(out.plan.create).toHaveLength(1);
    const posted = out.plan.create[0];
    expect(posted.file).toBe("app.ts");
    expect(posted.line).toBe(2);
    expect(posted.position).toBe(2); // diff position for new line 2
    expect(out.summary.rejected).toBe(1);
  });

  it("is idempotent across a re-run with no code changes (update, not duplicate)", () => {
    const verifier = JSON.stringify([
      {
        verdict: "confirmed",
        file: "app.ts",
        line: 2,
        category: "logic",
        severity: "important",
        confidence: 0.9,
        evidence: "app.ts:2 uses x before init",
        suggestion: null,
      },
    ]);
    const first = runPipeline({
      verifierStdout: verifier,
      files: [{ filename: "app.ts", patch }],
      prior: [],
    });
    const fp = first.plan.create[0].fingerprint;

    // Second run: same finding, now tracked as an open prior comment.
    const second = runPipeline({
      verifierStdout: verifier,
      files: [{ filename: "app.ts", patch }],
      prior: [{ fingerprint: fp, commentId: 42, state: "open" }],
    });
    expect(second.plan.create).toHaveLength(0);
    expect(second.plan.update).toEqual([
      { finding: second.plan.update[0].finding, commentId: 42 },
    ]);
  });
});
