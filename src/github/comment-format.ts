// Pure rendering of comment bodies. No I/O. The committable suggestion is only
// rendered when the verifier supplied one (it does so only when a one-click fix
// fully resolves the issue — see finding-verifier.md).

import { embedMarker, SUMMARY_MARKER } from "./marker.js";
import type { PostableFinding } from "../types.js";
import type { PolicyResult } from "../policy.js";

const BADGE: Record<PostableFinding["severity"], string> = {
  important: "🔴 **Important**",
  nit: "🔵 **Nit**",
};

export function renderCommentBody(f: PostableFinding): string {
  const parts: string[] = [
    `${BADGE[f.severity]} · _${f.category}_`,
    "",
    f.evidence,
  ];
  if (f.suggestion !== null && f.suggestion.length > 0) {
    parts.push("", "```suggestion", f.suggestion, "```");
  }
  parts.push("", embedMarker(f.fingerprint));
  return parts.join("\n");
}

export interface ReviewMetrics {
  model?: string;
  costUsd?: number;
  durationMs?: number;
  diffLines?: number;
  findingCount?: number;
  commitSha?: string;
  timestamp?: string;
}

export function renderSummary(
  summary: PolicyResult["summary"],
  extraNitCount: number,
  metrics?: ReviewMetrics
): string {
  const lines = [
    SUMMARY_MARKER,
    "### Claude Code Review",
    "",
    `- 🔴 Important: **${summary.important}**`,
    `- 🔵 Nit: **${summary.nit}**`,
  ];
  if (extraNitCount > 0)
    lines.push(`- …plus ${extraNitCount} more nit(s) not shown`);
  if (summary.preExisting > 0)
    lines.push(`- ⚪ Pre-existing (not posted): ${summary.preExisting}`);
  lines.push(
    "",
    `_Filtered out: ${summary.rejected} rejected by verification, ` +
      `${summary.droppedByThreshold} below confidence threshold._`,
    "",
    "React 👎 on a comment to suppress that finding on future pushes."
  );

  if (metrics) {
    const parts: string[] = [];
    if (metrics.model) parts.push(`Model: ${metrics.model}`);
    if (metrics.costUsd !== undefined)
      parts.push(`Cost: $${metrics.costUsd.toFixed(2)}`);
    if (metrics.durationMs !== undefined)
      parts.push(`Duration: ${Math.round(metrics.durationMs / 1000)}s`);
    if (metrics.diffLines !== undefined)
      parts.push(`Diff: ${metrics.diffLines} lines`);
    if (metrics.findingCount !== undefined)
      parts.push(`${metrics.findingCount} findings`);
    if (metrics.commitSha) {
      const short = metrics.commitSha.slice(0, 7);
      const ts =
        metrics.timestamp ??
        new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
      parts.push(`${short} @ ${ts}`);
    }
    if (parts.length > 0) {
      lines.push("", `<sub>${parts.join(" | ")}</sub>`);
    }
  }

  return lines.join("\n");
}
