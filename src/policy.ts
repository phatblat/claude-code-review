// The policy layer turns verifier output into what actually gets posted.
// The model emits judgment (verdict, severity, confidence); this code applies
// policy (thresholds, caps). Keeping policy here means you can tune behavior
// and A/B it deterministically without touching a single prompt.

import type { VerifiedFinding } from "./types.js";

export interface PolicyConfig {
  /** Post findings the verifier marked pre_existing? Usually false. */
  postPreExisting: boolean;
  /** Minimum confidence to post, per severity. */
  thresholds: { important: number; nit: number };
  /** Max nit comments to post inline; the rest are summarized as a count. */
  maxNits: number;
}

export const DEFAULT_POLICY: PolicyConfig = {
  postPreExisting: false,
  thresholds: { important: 0.5, nit: 0.85 },
  maxNits: 5,
};

export interface PolicyResult {
  post: VerifiedFinding[];
  /** Nits found but not posted inline, surfaced as "plus N similar" in summary. */
  extraNitCount: number;
  summary: {
    important: number;
    nit: number;
    preExisting: number;
    droppedByThreshold: number;
    rejected: number;
  };
}

export function applyPolicy(
  findings: VerifiedFinding[],
  cfg: PolicyConfig = DEFAULT_POLICY,
): PolicyResult {
  const summary = {
    important: 0,
    nit: 0,
    preExisting: 0,
    droppedByThreshold: 0,
    rejected: 0,
  };

  const eligible: VerifiedFinding[] = [];

  for (const f of findings) {
    if (f.verdict === "rejected") {
      summary.rejected++;
      continue;
    }
    if (f.verdict === "pre_existing") {
      summary.preExisting++;
      if (!cfg.postPreExisting) continue;
    }
    const threshold = cfg.thresholds[f.severity];
    if (f.confidence < threshold) {
      summary.droppedByThreshold++;
      continue;
    }
    eligible.push(f);
  }

  // Important first, then by confidence descending; stable for equal keys.
  const ranked = eligible
    .map((f, i) => ({ f, i }))
    .sort((a, b) => {
      const sev = severityRank(b.f.severity) - severityRank(a.f.severity);
      if (sev !== 0) return sev;
      if (b.f.confidence !== a.f.confidence) return b.f.confidence - a.f.confidence;
      return a.i - b.i;
    })
    .map((x) => x.f);

  const post: VerifiedFinding[] = [];
  let nitsPosted = 0;
  let extraNitCount = 0;

  for (const f of ranked) {
    if (f.severity === "nit") {
      if (nitsPosted >= cfg.maxNits) {
        extraNitCount++;
        continue;
      }
      nitsPosted++;
      summary.nit++;
    } else {
      summary.important++;
    }
    post.push(f);
  }

  return { post, extraNitCount, summary };
}

function severityRank(s: "important" | "nit"): number {
  return s === "important" ? 1 : 0;
}
