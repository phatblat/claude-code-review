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
  const parts: string[] = [`${BADGE[f.severity]} · _${f.category}_`, "", f.evidence];
  if (f.suggestion !== null && f.suggestion.length > 0) {
    parts.push("", "```suggestion", f.suggestion, "```");
  }
  parts.push("", embedMarker(f.fingerprint));
  return parts.join("\n");
}

export function renderSummary(summary: PolicyResult["summary"], extraNitCount: number): string {
  const lines = [
    SUMMARY_MARKER,
    "### Claude Code Review",
    "",
    `- 🔴 Important: **${summary.important}**`,
    `- 🔵 Nit: **${summary.nit}**`,
  ];
  if (extraNitCount > 0) lines.push(`- …plus ${extraNitCount} more nit(s) not shown`);
  if (summary.preExisting > 0) lines.push(`- ⚪ Pre-existing (not posted): ${summary.preExisting}`);
  lines.push(
    "",
    `_Filtered out: ${summary.rejected} rejected by verification, ` +
      `${summary.droppedByThreshold} below confidence threshold._`,
    "",
    "React 👎 on a comment to suppress that finding on future pushes.",
  );
  return lines.join("\n");
}
