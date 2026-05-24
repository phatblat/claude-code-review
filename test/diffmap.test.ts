import { describe, it, expect } from "vitest";
import { positionForLine, addedLines, changedLinesFromPatches } from "../src/diffmap.js";

// Two-hunk patch. Positions counted from the line after the first @@.
const patch = [
  "@@ -1,4 +1,5 @@", // first hunk header: anchor, not counted; new starts at line 1
  " line a", //          pos 1, new line 1
  "-old line b", //      pos 2, deletion (no new line)
  "+new line b", //      pos 3, new line 2
  "+inserted line c", // pos 4, new line 3
  " line d", //          pos 5, new line 4
  "@@ -10,3 +11,4 @@", // second hunk header: counted -> pos 6; new starts at 11
  " line j", //          pos 7, new line 11
  " line k", //          pos 8, new line 12
  "+line L", //          pos 9, new line 13
  " line m", //          pos 10, new line 14
].join("\n");

describe("positionForLine", () => {
  it("maps a context line in the first hunk", () => {
    expect(positionForLine(patch, 1)).toBe(1);
  });

  it("maps additions in the first hunk", () => {
    expect(positionForLine(patch, 2)).toBe(3);
    expect(positionForLine(patch, 3)).toBe(4);
  });

  it("counts the second hunk header toward position", () => {
    expect(positionForLine(patch, 11)).toBe(7);
    expect(positionForLine(patch, 13)).toBe(9); // the added line in hunk 2
    expect(positionForLine(patch, 14)).toBe(10);
  });

  it("returns null for a line not present in the diff", () => {
    expect(positionForLine(patch, 99)).toBeNull();
    expect(positionForLine(patch, 7)).toBeNull(); // gap between hunks
  });

  it("handles a single-hunk patch", () => {
    const p = ["@@ -1,2 +1,3 @@", " a", "+b", " c"].join("\n");
    expect(positionForLine(p, 1)).toBe(1);
    expect(positionForLine(p, 2)).toBe(2);
    expect(positionForLine(p, 3)).toBe(3);
  });
});

describe("addedLines", () => {
  it("returns only the '+' new-side line numbers", () => {
    expect([...addedLines(patch)].sort((a, b) => a - b)).toEqual([2, 3, 13]);
  });
});

describe("changedLinesFromPatches", () => {
  it("builds a file -> added-line-set map and skips files with no patch", () => {
    const map = changedLinesFromPatches([
      { filename: "a.ts", patch },
      { filename: "binary.png" }, // no patch
    ]);
    expect(map.has("binary.png")).toBe(false);
    expect([...map.get("a.ts")!].sort((a, b) => a - b)).toEqual([2, 3, 13]);
  });
});
