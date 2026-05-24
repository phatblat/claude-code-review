import { describe, it, expect } from "vitest";
import {
  globToRegExp,
  isSkipped,
  dropSkippedPaths,
  dropEnforcedByCi,
  dropOutsideDiff,
  dedupe,
} from "../src/prefilters.js";

describe("globToRegExp", () => {
  it("matches a single segment with *", () => {
    expect(globToRegExp("*.lock").test("pnpm.lock")).toBe(true);
    expect(globToRegExp("*.lock").test("dir/pnpm.lock")).toBe(false);
  });

  it("matches across segments with **", () => {
    expect(globToRegExp("**/*.lock").test("a/b/c.lock")).toBe(true);
    expect(globToRegExp("**/*.lock").test("c.lock")).toBe(true);
  });

  it("matches a directory subtree with trailing **", () => {
    const re = globToRegExp("src/gen/**");
    expect(re.test("src/gen/api.ts")).toBe(true);
    expect(re.test("src/gen/deep/nested.ts")).toBe(true);
    expect(re.test("src/handwritten.ts")).toBe(false);
  });
});

describe("isSkipped / dropSkippedPaths", () => {
  const skip = ["**/*.lock", "src/gen/**", "vendor/**"];
  it("flags skipped paths", () => {
    expect(isSkipped("yarn.lock", skip)).toBe(true);
    expect(isSkipped("src/gen/x.ts", skip)).toBe(true);
    expect(isSkipped("src/app.ts", skip)).toBe(false);
  });
  it("drops findings on skipped paths", () => {
    const findings = [{ file: "src/app.ts" }, { file: "src/gen/x.ts" }, { file: "yarn.lock" }];
    expect(dropSkippedPaths(findings, skip)).toEqual([{ file: "src/app.ts" }]);
  });
});

describe("dropEnforcedByCi", () => {
  it("drops categories CI already enforces, case-insensitively", () => {
    const findings = [
      { category: "logic" },
      { category: "Style" },
      { category: "format" },
    ];
    expect(dropEnforcedByCi(findings, ["style", "format"])).toEqual([{ category: "logic" }]);
  });
});

describe("dropOutsideDiff", () => {
  it("keeps only findings on changed lines", () => {
    const changed = new Map([["a.ts", new Set([10, 11])]]);
    const findings = [
      { file: "a.ts", line: 10 },
      { file: "a.ts", line: 99 },
      { file: "b.ts", line: 10 },
    ];
    expect(dropOutsideDiff(findings, changed)).toEqual([{ file: "a.ts", line: 10 }]);
  });
});

describe("dedupe", () => {
  it("collapses findings with the same file/category/normalized claim", () => {
    const findings = [
      { file: "a.ts", category: "logic", claim: "X is null when Y empty" },
      { file: "a.ts", category: "logic", claim: "x is null, when y empty!!" }, // same after normalize
      { file: "a.ts", category: "logic", claim: "different issue" },
    ];
    const out = dedupe(findings);
    expect(out).toHaveLength(2);
  });

  it("treats different files as distinct", () => {
    const findings = [
      { file: "a.ts", category: "logic", claim: "same claim" },
      { file: "b.ts", category: "logic", claim: "same claim" },
    ];
    expect(dedupe(findings)).toHaveLength(2);
  });
});
