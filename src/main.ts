// Action entrypoint. Two modes:
// 1. --extract-candidates: reads reviewer execution files, extracts JSONL
//    candidates, sets outputs for the verification step.
// 2. Default: reads verifier output, runs the posting pipeline.

import * as core from "@actions/core";
import * as github from "@actions/github";
import { OctokitGitHubPort } from "./github/octokit-adapter.js";
import { executeReview } from "./post-review.js";
import { readFileSync } from "fs";
import { parseConfigFile, mergeConfigs, parsePolicy } from "./config.js";

if (process.argv.includes("--extract-candidates")) {
  extractCandidates();
} else {
  main().catch((err) =>
    core.setFailed(err instanceof Error ? err.message : String(err))
  );
}

function extractCandidates(): void {
  const files = [
    process.env.LOGIC_OUTPUT_FILE,
    process.env.SECURITY_OUTPUT_FILE,
  ].filter((f): f is string => !!f);

  const candidates: string[] = [];
  let totalCost = 0;
  let totalDuration = 0;

  for (const file of files) {
    try {
      const raw = readFileSync(file, "utf-8");
      const { cost, duration } = extractMetricsFromTranscript(raw);
      totalCost += cost;
      totalDuration += duration;
      const text = extractRawResultText(raw);
      core.info(`reviewer result text (first 500): ${text.slice(0, 500)}`);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("```")) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (
            parsed &&
            typeof parsed === "object" &&
            parsed.file &&
            parsed.claim
          ) {
            candidates.push(trimmed);
          }
        } catch {
          // not valid JSON — skip
        }
      }
    } catch {
      core.warning(`could not read execution file: ${file}`);
    }
  }

  core.info(
    `extracted ${candidates.length} candidate(s), cost so far: $${totalCost.toFixed(2)}`
  );
  core.setOutput("candidate_count", String(candidates.length));
  core.setOutput("candidates", candidates.join("\n"));
  core.setOutput("cost_usd", String(totalCost));
  core.setOutput("duration_ms", String(totalDuration));
}

async function main(): Promise<void> {
  const token = required("CCR_GITHUB_TOKEN");
  const [owner, repo] = required("REPO").split("/");
  const prNumber = Number(required("PR_NUMBER"));
  let verifierStdout = "[]";
  const outputFile = process.env.VERIFIER_OUTPUT_FILE;
  if (outputFile) {
    try {
      const raw = readFileSync(outputFile, "utf-8");
      verifierStdout = extractResultText(raw);
    } catch {
      core.warning(`could not read verifier output file: ${outputFile}`);
    }
  }

  core.info(
    `token length: ${token.length}, owner: ${owner}, repo: ${repo}, pr: ${prNumber}`
  );
  const octokit = github.getOctokit(token);

  let pr;
  try {
    pr = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });
  } catch (err) {
    core.setFailed(
      `pulls.get failed: ${err instanceof Error ? err.message : err}`
    );
    return;
  }
  const headSha = pr.data.head.sha;
  const prAuthor = pr.data.user?.login ?? "";

  const port = new OctokitGitHubPort(octokit, {
    owner,
    repo,
    prNumber,
    headSha,
    prAuthor,
  });

  let fileConfig = { policy: parsePolicy({}), skipGlobs: [] as string[] };
  const configPath = ".github/claude-code-review.yml";
  try {
    fileConfig = parseConfigFile(readFileSync(configPath, "utf-8"));
    core.info(`loaded config from ${configPath}`);
  } catch {
    // no config file — use defaults
  }

  const { policy, skipGlobs } = mergeConfigs(fileConfig, process.env);

  let verifyCost = 0;
  let verifyDuration = 0;
  if (outputFile) {
    try {
      const raw = readFileSync(outputFile, "utf-8");
      const m = extractMetricsFromTranscript(raw);
      verifyCost = m.cost;
      verifyDuration = m.duration;
    } catch {
      // already warned above
    }
  }

  const priorCost = Number(process.env.CCR_PRIOR_COST_USD || "0");
  const priorDuration = Number(process.env.CCR_PRIOR_DURATION_MS || "0");

  const result = await executeReview(port, {
    verifierStdout,
    skipGlobs,
    policy,
    metrics: {
      model: process.env.CCR_MODEL,
      costUsd: priorCost + verifyCost,
      durationMs: priorDuration + verifyDuration,
      commitSha: headSha,
      timestamp:
        new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    },
  });

  if (result.parseErrors.length > 0) {
    core.warning(
      `verifier output had ${result.parseErrors.length} unparseable record(s).`
    );
  }
  core.info(
    `created=${result.created} updated=${result.updated} resolved=${result.resolved} ` +
      `suppressed=${result.suppressed} not-inlineable=${result.notInlineable}`
  );
  core.setOutput("important", String(result.summary.important));
  core.setOutput("nit", String(result.summary.nit));
}

function extractRawResultText(raw: string): string {
  try {
    const messages = JSON.parse(raw);
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.type === "result" && typeof msg.result === "string") {
          return msg.result;
        }
      }
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
          for (const block of msg.message.content) {
            if (block.type === "text") return block.text;
          }
        }
      }
    }
  } catch {
    // not a JSON array — treat as raw output
  }
  return raw;
}

function extractResultText(raw: string): string {
  let text = raw;
  try {
    const messages = JSON.parse(raw);
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.type === "result" && typeof msg.result === "string") {
          text = msg.result;
          break;
        }
      }
      if (text === raw) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i];
          if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                text = block.text;
                break;
              }
            }
            if (text !== raw) break;
          }
        }
      }
    }
  } catch {
    // not a JSON array — treat as raw output
  }
  return extractJsonArray(text);
}

function extractJsonArray(text: string): string {
  const start = text.indexOf("[");
  if (start === -1) return text;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

function extractMetricsFromTranscript(raw: string): {
  cost: number;
  duration: number;
} {
  let cost = 0;
  let duration = 0;
  try {
    const messages = JSON.parse(raw);
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (msg.type === "result" && typeof msg.total_cost_usd === "number") {
          cost = msg.total_cost_usd;
        }
        if (msg.type === "result" && typeof msg.duration_ms === "number") {
          duration = msg.duration_ms;
        }
      }
    }
  } catch {
    // not parseable
  }
  return { cost, duration };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}
