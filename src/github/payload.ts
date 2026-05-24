// Build the GitHub review-comment payload from a finding. Pure.
//
// API choice: we post with `line` + `side: "RIGHT"` (the modern reviews API),
// not the deprecated `position`. The `position` computed by diffmap.ts is
// repurposed as the "is this line actually in the diff" gate — if it's null,
// the line can't carry an inline comment and the finding is reflected only in
// the summary.

import { renderCommentBody } from "./comment-format.js";
import type { PostableFinding } from "../types.js";

export interface ReviewCommentPayload {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export function toReviewComment(f: PostableFinding): ReviewCommentPayload {
  return {
    path: f.file,
    line: f.line,
    side: "RIGHT",
    body: renderCommentBody(f),
  };
}

/** A finding can be posted inline only if diffmap could place it in the diff. */
export function canPostInline(f: PostableFinding): boolean {
  return f.position !== null;
}
