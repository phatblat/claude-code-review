// Composes the deterministic stages into one pure function:
//   verifier stdout + diff + prior state  ->  a plan of GitHub actions.
// No network here. The caller runs the plan against the GitHub API.

import type { PostableFinding, PriorComment } from "./types.js";
import { parseVerdicts } from "./schema.js";
import { dropSkippedPaths, dropOutsideDiff, dedupe } from "./prefilters.js";
import { applyPolicy, DEFAULT_POLICY, type PolicyConfig } from "./policy.js";
import { positionForLine, changedLinesFromPatches } from "./diffmap.js";
import { reconcile, type ReconcilePlan } from "./reconcile.js";
import { fingerprint } from "./fingerprint.js";

export interface PipelineInput {
  verifierStdout: string;
  files: { filename: string; patch?: string }[];
  prior: PriorComment[];
  skipGlobs?: string[];
  policy?: PolicyConfig;
}

export interface PipelineOutput {
  plan: ReconcilePlan;
  extraNitCount: number;
  summary: ReturnType<typeof applyPolicy>["summary"];
  parseErrors: string[];
}

export function runPipeline(input: PipelineInput): PipelineOutput {
  const { ok: verified, errors } = parseVerdicts(input.verifierStdout);

  const changedLines = changedLinesFromPatches(input.files);
  const patchByFile = new Map(input.files.map((f) => [f.filename, f.patch ?? ""]));

  // Deterministic pre-filters on verified findings.
  let findings = verified;
  if (input.skipGlobs?.length) findings = dropSkippedPaths(findings, input.skipGlobs);
  findings = dropOutsideDiff(findings, changedLines);
  findings = dedupe(findings);

  // Policy: thresholds, severity gating, nit cap.
  const { post, extraNitCount, summary } = applyPolicy(
    findings,
    input.policy ?? DEFAULT_POLICY,
  );

  // Attach fingerprint + diff position.
  const postable: PostableFinding[] = post.map((f) => ({
    ...f,
    fingerprint: fingerprint(f.file, f.category, f.evidence),
    position: positionForLine(patchByFile.get(f.file) ?? "", f.line),
  }));

  const plan = reconcile(postable, input.prior);
  return { plan, extraNitCount, summary, parseErrors: errors };
}
