// Data contract shared across the deterministic pipeline.
// Candidates come from the generation-pass reviewers (JSONL).
// VerifiedFindings come from the verification-pass verifier (JSON array).

export type Severity = "important" | "nit";
export type Verdict = "confirmed" | "rejected" | "pre_existing";

/** Output of a generation-pass reviewer (one per line, JSONL). */
export interface Candidate {
  file: string;
  line: number;
  category: string;
  claim: string;
  severity: Severity;
}

/** Output of the verifier (one per candidate). */
export interface VerifiedFinding {
  verdict: Verdict;
  file: string;
  line: number;
  category: string;
  severity: Severity;
  confidence: number; // 0..1
  evidence: string;
  suggestion: string | null;
}

/** A finding that survived policy and is ready to be posted. */
export interface PostableFinding extends VerifiedFinding {
  fingerprint: string;
  /** GitHub unified-diff position for an inline comment, or null if unmappable. */
  position: number | null;
}

/** Prior state for one fingerprint, carried across pushes. */
export interface PriorComment {
  fingerprint: string;
  commentId: number;
  state: "open" | "resolved" | "dismissed";
}
