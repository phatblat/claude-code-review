// Action entrypoint. Reads env (set by action.yml), builds the octokit adapter,
// and runs the orchestration. This file is thin glue — all logic worth testing
// lives in post-review.ts and the pure modules it calls.

import * as core from "@actions/core";
import * as github from "@actions/github";
import { OctokitGitHubPort } from "./github/octokit-adapter.js";
import { executeReview } from "./post-review.js";
import { parsePolicy, parseSkipGlobs } from "./config.js";

async function main(): Promise<void> {
  const token = required("GITHUB_TOKEN");
  const [owner, repo] = required("REPO").split("/");
  const prNumber = Number(required("PR_NUMBER"));
  const verifierStdout = process.env.VERIFIER_OUTPUT ?? "[]";

  const octokit = github.getOctokit(token);

  // Need the head SHA to anchor inline comments.
  const pr = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const headSha = pr.data.head.sha;

  const port = new OctokitGitHubPort(octokit, { owner, repo, prNumber, headSha });

  const result = await executeReview(port, {
    verifierStdout,
    skipGlobs: parseSkipGlobs(process.env.SKIP_GLOBS),
    policy: parsePolicy(process.env),
  });

  if (result.parseErrors.length > 0) {
    core.warning(`verifier output had ${result.parseErrors.length} unparseable record(s).`);
  }
  core.info(
    `created=${result.created} updated=${result.updated} resolved=${result.resolved} ` +
      `suppressed=${result.suppressed} not-inlineable=${result.notInlineable}`,
  );
  core.setOutput("important", String(result.summary.important));
  core.setOutput("nit", String(result.summary.nit));
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}

main().catch((err) => core.setFailed(err instanceof Error ? err.message : String(err)));
