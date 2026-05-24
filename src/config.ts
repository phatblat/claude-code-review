// Pure parsing of action inputs (passed as env) into a PolicyConfig + skip
// globs. Falls back to DEFAULT_POLICY for anything missing or malformed.

import { DEFAULT_POLICY, type PolicyConfig } from "./policy.js";

type Env = Record<string, string | undefined>;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePolicy(env: Env): PolicyConfig {
  return {
    postPreExisting: env.CCR_POST_PRE_EXISTING === "true",
    thresholds: {
      important: num(env.CCR_IMPORTANT_THRESHOLD, DEFAULT_POLICY.thresholds.important),
      nit: num(env.CCR_NIT_THRESHOLD, DEFAULT_POLICY.thresholds.nit),
    },
    maxNits: num(env.CCR_MAX_NITS, DEFAULT_POLICY.maxNits),
  };
}

export function parseSkipGlobs(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
