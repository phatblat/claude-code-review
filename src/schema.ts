// Parse and validate model output. The model can emit malformed lines, code
// fences, or extra prose; none of that should crash the run. Bad records are
// dropped and reported, good records are returned.

import type { Candidate, VerifiedFinding, Severity, Verdict } from "./types.js";

const SEVERITIES: Severity[] = ["important", "nit"];
const VERDICTS: Verdict[] = ["confirmed", "rejected", "pre_existing"];

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z]*\n?/g, "").replace(/```/g, "");
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export interface ParseResult<T> {
  ok: T[];
  errors: string[];
}

function validateCandidate(x: unknown): Candidate | string {
  if (!isObject(x)) return "not an object";
  if (typeof x.file !== "string" || x.file.length === 0) return "missing file";
  if (typeof x.line !== "number" || !Number.isInteger(x.line) || x.line < 1)
    return "invalid line";
  if (typeof x.category !== "string" || x.category.length === 0)
    return "missing category";
  if (typeof x.claim !== "string" || x.claim.length === 0) return "missing claim";
  if (!SEVERITIES.includes(x.severity as Severity)) return "invalid severity";
  return {
    file: x.file,
    line: x.line,
    category: x.category,
    claim: x.claim,
    severity: x.severity as Severity,
  };
}

function validateFinding(x: unknown): VerifiedFinding | string {
  if (!isObject(x)) return "not an object";
  if (!VERDICTS.includes(x.verdict as Verdict)) return "invalid verdict";
  if (typeof x.file !== "string" || x.file.length === 0) return "missing file";
  if (typeof x.line !== "number" || !Number.isInteger(x.line) || x.line < 1)
    return "invalid line";
  if (typeof x.category !== "string") return "missing category";
  if (!SEVERITIES.includes(x.severity as Severity)) return "invalid severity";
  if (typeof x.confidence !== "number" || x.confidence < 0 || x.confidence > 1)
    return "invalid confidence";
  if (typeof x.evidence !== "string") return "missing evidence";
  const suggestion =
    x.suggestion === null || x.suggestion === undefined
      ? null
      : typeof x.suggestion === "string"
        ? x.suggestion
        : "INVALID";
  if (suggestion === "INVALID") return "invalid suggestion";
  return {
    verdict: x.verdict as Verdict,
    file: x.file,
    line: x.line,
    category: x.category,
    severity: x.severity as Severity,
    confidence: x.confidence,
    evidence: x.evidence,
    suggestion,
  };
}

/** Parse JSONL of generation-pass candidates. Malformed lines are skipped. */
export function parseCandidates(jsonl: string): ParseResult<Candidate> {
  const ok: Candidate[] = [];
  const errors: string[] = [];
  const lines = stripFences(jsonl).split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      errors.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    const result = validateCandidate(parsed);
    if (typeof result === "string") errors.push(`line ${i + 1}: ${result}`);
    else ok.push(result);
  });
  return { ok, errors };
}

/** Parse the verifier output: a JSON array, or JSONL as a fallback. */
export function parseVerdicts(text: string): ParseResult<VerifiedFinding> {
  const cleaned = stripFences(text).trim();
  const ok: VerifiedFinding[] = [];
  const errors: string[] = [];

  let records: unknown[] | null = null;
  try {
    const whole = JSON.parse(cleaned);
    if (Array.isArray(whole)) records = whole;
    else if (isObject(whole)) records = [whole];
  } catch {
    // fall through to JSONL
  }

  if (records === null) {
    records = [];
    cleaned.split("\n").forEach((raw, i) => {
      const line = raw.trim();
      if (line === "") return;
      try {
        records!.push(JSON.parse(line));
      } catch {
        errors.push(`line ${i + 1}: not valid JSON`);
      }
    });
  }

  records.forEach((rec, i) => {
    const result = validateFinding(rec);
    if (typeof result === "string") errors.push(`record ${i + 1}: ${result}`);
    else ok.push(result);
  });

  return { ok, errors };
}
