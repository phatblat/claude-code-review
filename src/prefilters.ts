// Cheap, deterministic noise reduction. Runs before (dedupe, skip-globs) and
// after (CI-covered, outside-diff) the model passes. None of this needs an LLM,
// so none of it should cost tokens or be left to model judgment.

import type { Candidate, VerifiedFinding } from "./types.js";
import { fingerprint } from "./fingerprint.js";

/** Minimal glob -> RegExp. Supports `*` (within a segment) and `**` (across). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export function isSkipped(path: string, skipGlobs: string[]): boolean {
  return skipGlobs.some((g) => globToRegExp(g).test(path));
}

/** Drop findings on paths matching any skip glob (generated, lockfiles, vendored). */
export function dropSkippedPaths<T extends { file: string }>(
  findings: T[],
  skipGlobs: string[],
): T[] {
  return findings.filter((f) => !isSkipped(f.file, skipGlobs));
}

/** Drop findings in categories already enforced by CI (lint, format, types). */
export function dropEnforcedByCi<T extends { category: string }>(
  findings: T[],
  enforcedCategories: Iterable<string>,
): T[] {
  const enforced = new Set([...enforcedCategories].map((c) => c.toLowerCase()));
  return findings.filter((f) => !enforced.has(f.category.toLowerCase()));
}

/**
 * Keep only findings whose (file, line) was actually changed in this PR.
 * `changedLines` maps a file path to the set of new-side line numbers.
 */
export function dropOutsideDiff<T extends { file: string; line: number }>(
  findings: T[],
  changedLines: Map<string, Set<number>>,
): T[] {
  return findings.filter((f) => changedLines.get(f.file)?.has(f.line) ?? false);
}

/** Collapse duplicates by fingerprint (file + category + normalized claim). */
export function dedupe<T extends { file: string; category: string; claim?: string; evidence?: string }>(
  findings: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of findings) {
    const claimText = f.claim ?? f.evidence ?? "";
    const fp = fingerprint(f.file, f.category, claimText);
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push(f);
  }
  return out;
}

/** Convenience: full pre-verification candidate cleanup. */
export function prefilterCandidates(
  candidates: Candidate[],
  opts: { skipGlobs?: string[]; enforcedByCi?: string[] } = {},
): Candidate[] {
  let out = candidates;
  if (opts.skipGlobs?.length) out = dropSkippedPaths(out, opts.skipGlobs);
  if (opts.enforcedByCi?.length) out = dropEnforcedByCi(out, opts.enforcedByCi);
  return dedupe(out);
}

export type { VerifiedFinding };
