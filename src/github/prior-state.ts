// Reconstruct PriorComment[] from data the GitHub adapter fetched. Pure given
// its inputs, so the state machine is unit-tested without any API.
//
// Precedence: a 👎 dismissal wins over a resolved thread — if the author
// explicitly rejected the finding, we never want to resurface it, even if the
// thread was later marked resolved.

import { parseMarker } from "./marker.js";
import type { PriorComment } from "../types.js";

export interface RawComment {
  id: number;
  nodeId: string;
  body: string;
}

export function derivePriorComments(
  comments: RawComment[],
  downvotedIds: Set<number>,
  resolvedIds: Set<number>
): PriorComment[] {
  const out: PriorComment[] = [];
  for (const c of comments) {
    const fingerprint = parseMarker(c.body);
    if (!fingerprint) continue; // not one of our findings
    const state: PriorComment["state"] = downvotedIds.has(c.id)
      ? "dismissed"
      : resolvedIds.has(c.id)
        ? "resolved"
        : "open";
    out.push({ fingerprint, commentId: c.id, state });
  }
  return out;
}
