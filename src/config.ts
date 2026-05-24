// Pure parsing of action inputs (env) and repo-level config file into a
// PolicyConfig + skip globs. Precedence: action inputs > config file > defaults.

import yaml from "js-yaml";
import { DEFAULT_POLICY, type PolicyConfig } from "./policy.js";

type Env = Record<string, string | undefined>;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

export interface RepoConfig {
  policy: PolicyConfig;
  skipGlobs: string[];
}

export function parseConfigFile(text: string): RepoConfig {
  let raw: unknown;
  try {
    raw = yaml.load(text);
  } catch {
    return { policy: { ...DEFAULT_POLICY }, skipGlobs: [] };
  }
  if (!isObject(raw)) return { policy: { ...DEFAULT_POLICY }, skipGlobs: [] };

  const thresholds = isObject(raw.thresholds) ? raw.thresholds : {};

  const policy: PolicyConfig = {
    postPreExisting: raw.post_pre_existing === true,
    thresholds: {
      important: num(thresholds.important, DEFAULT_POLICY.thresholds.important),
      nit: num(thresholds.nit, DEFAULT_POLICY.thresholds.nit),
    },
    maxNits: num(raw.max_nits, DEFAULT_POLICY.maxNits),
  };

  let skipGlobs: string[] = [];
  if (Array.isArray(raw.skip_globs)) {
    skipGlobs = raw.skip_globs.filter(
      (g): g is string => typeof g === "string" && g.length > 0
    );
  }

  return { policy, skipGlobs };
}

export function mergeConfigs(
  fileConfig: RepoConfig,
  env: Env
): { policy: PolicyConfig; skipGlobs: string[] } {
  const envPolicy = parsePolicy(env);
  const envGlobs = parseSkipGlobs(env.SKIP_GLOBS);

  return {
    policy: {
      postPreExisting:
        env.CCR_POST_PRE_EXISTING !== undefined
          ? envPolicy.postPreExisting
          : fileConfig.policy.postPreExisting,
      thresholds: {
        important:
          env.CCR_IMPORTANT_THRESHOLD !== undefined
            ? envPolicy.thresholds.important
            : fileConfig.policy.thresholds.important,
        nit:
          env.CCR_NIT_THRESHOLD !== undefined
            ? envPolicy.thresholds.nit
            : fileConfig.policy.thresholds.nit,
      },
      maxNits:
        env.CCR_MAX_NITS !== undefined
          ? envPolicy.maxNits
          : fileConfig.policy.maxNits,
    },
    skipGlobs: envGlobs.length > 0 ? envGlobs : fileConfig.skipGlobs,
  };
}

export function parsePolicy(env: Env): PolicyConfig {
  return {
    postPreExisting: env.CCR_POST_PRE_EXISTING === "true",
    thresholds: {
      important: num(
        env.CCR_IMPORTANT_THRESHOLD,
        DEFAULT_POLICY.thresholds.important
      ),
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
