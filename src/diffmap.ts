// Map a new-side line number to a GitHub unified-diff "position" for inline
// review comments. This is the classic footgun: `position` is the offset from
// the first @@ hunk header, counting EVERY line (context, additions, deletions,
// and subsequent hunk headers), not the file's line number. The newer reviews
// API accepts `line`+`side` directly and is simpler — but many flows still use
// `position`, and this is exactly the logic that earns unit tests.

const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

interface PatchScan {
  /** new-side line number -> diff position */
  positionByLine: Map<number, number>;
  /** new-side line numbers that are additions ('+') */
  addedLines: Set<number>;
}

function scanPatch(patch: string): PatchScan {
  const positionByLine = new Map<number, number>();
  const addedLines = new Set<number>();
  const lines = patch.split("\n");

  let position = 0;
  let newLine = 0;
  let seenHunk = false;

  for (const raw of lines) {
    const m = HUNK_RE.exec(raw);
    if (m) {
      newLine = parseInt(m[1], 10);
      if (!seenHunk) {
        // First hunk header is the anchor: the line just below it is position 1.
        seenHunk = true;
      } else {
        // Subsequent hunk headers DO count toward position.
        position++;
      }
      continue;
    }
    if (!seenHunk) continue; // skip any preamble before the first hunk

    position++;
    const tag = raw[0];
    if (tag === "+") {
      positionByLine.set(newLine, position);
      addedLines.add(newLine);
      newLine++;
    } else if (tag === " ") {
      positionByLine.set(newLine, position);
      newLine++;
    } else if (tag === "-") {
      // deletion: occupies a position, does not advance the new-side line
    } else {
      // "\ No newline at end of file" or stray line: counts, no line advance
    }
  }

  return { positionByLine, addedLines };
}

/** Position for a comment on `newLine`, or null if that line isn't in the diff. */
export function positionForLine(patch: string, newLine: number): number | null {
  return scanPatch(patch).positionByLine.get(newLine) ?? null;
}

/** Set of new-side line numbers that were added ('+') in this patch. */
export function addedLines(patch: string): Set<number> {
  return scanPatch(patch).addedLines;
}

/**
 * Build the changedLines map (file -> set of added new-side lines) that
 * `dropOutsideDiff` expects, from a list of per-file patches.
 */
export function changedLinesFromPatches(
  files: { filename: string; patch?: string }[],
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const f of files) {
    if (!f.patch) continue;
    map.set(f.filename, addedLines(f.patch));
  }
  return map;
}
