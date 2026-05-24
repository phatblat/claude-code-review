// Eval scorer for the prompt layer. Runs runPipeline() against labeled
// fixtures and reports verifier precision/recall by class.
//
// Usage: npx tsx evals/scorer.ts

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { runPipeline } from "../src/index.js";
import type { Verdict } from "../src/types.js";

interface ExpectedFinding {
  file: string;
  category: string;
  verdict: Verdict;
  description: string;
}

interface EvalFixture {
  name: string;
  description: string;
  files: { filename: string; patch: string }[];
  verifierOutput: string;
  expected: ExpectedFinding[];
}

interface ClassScore {
  tp: number;
  fp: number;
  fn: number;
}

function loadFixtures(dir: string): EvalFixture[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), "utf-8");
    return JSON.parse(raw) as EvalFixture;
  });
}

function scoreFixture(fixture: EvalFixture): {
  perClass: Map<string, ClassScore>;
  details: string[];
} {
  const { plan } = runPipeline({
    verifierStdout: fixture.verifierOutput,
    files: fixture.files,
    prior: [],
  });

  const posted = new Set(
    [...plan.create, ...plan.update.map((u) => u.finding)].map(
      (f) => `${f.file}::${f.category}`
    )
  );

  const perClass = new Map<string, ClassScore>();
  const details: string[] = [];

  function getClass(cls: string): ClassScore {
    if (!perClass.has(cls)) perClass.set(cls, { tp: 0, fp: 0, fn: 0 });
    return perClass.get(cls)!;
  }

  for (const exp of fixture.expected) {
    const key = `${exp.file}::${exp.category}`;
    const wasPosted = posted.has(key);
    const shouldPost = exp.verdict === "confirmed";
    const score = getClass(exp.verdict);

    if (shouldPost && wasPosted) {
      score.tp++;
    } else if (shouldPost && !wasPosted) {
      score.fn++;
      details.push(`  FN: ${exp.description} (${key})`);
    } else if (!shouldPost && wasPosted) {
      score.fp++;
      details.push(`  FP: ${exp.description} (${key})`);
    } else {
      score.tp++;
    }
    posted.delete(key);
  }

  for (const extra of posted) {
    getClass("confirmed").fp++;
    details.push(`  FP (unexpected): ${extra}`);
  }

  return { perClass, details };
}

function precision(s: ClassScore): number {
  return s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
}

function recall(s: ClassScore): number {
  return s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
}

function main() {
  const fixtureDir = join(import.meta.dirname ?? ".", "fixtures");
  const fixtures = loadFixtures(fixtureDir);

  if (fixtures.length === 0) {
    console.error("No fixtures found in", fixtureDir);
    process.exit(1);
  }

  console.log(`\nEval: ${fixtures.length} fixtures\n`);

  const totals = new Map<string, ClassScore>();
  let allDetails: string[] = [];

  for (const fixture of fixtures) {
    const { perClass, details } = scoreFixture(fixture);
    console.log(
      `  ${fixture.name}: ${details.length === 0 ? "✓" : `${details.length} issue(s)`}`
    );
    allDetails = allDetails.concat(details);

    for (const [cls, score] of perClass) {
      const t = totals.get(cls) ?? { tp: 0, fp: 0, fn: 0 };
      t.tp += score.tp;
      t.fp += score.fp;
      t.fn += score.fn;
      totals.set(cls, t);
    }
  }

  console.log("\n--- Scores ---\n");
  for (const [cls, score] of totals) {
    const p = precision(score);
    const r = recall(score);
    console.log(
      `  ${cls.padEnd(14)} precision=${p.toFixed(2)}  recall=${r.toFixed(2)}  (tp=${score.tp} fp=${score.fp} fn=${score.fn})`
    );
  }

  if (allDetails.length > 0) {
    console.log("\n--- Details ---\n");
    for (const d of allDetails) console.log(d);
  }

  const confirmed = totals.get("confirmed") ?? { tp: 0, fp: 0, fn: 0 };
  const p = precision(confirmed);
  const r = recall(confirmed);
  console.log(
    `\nOverall confirmed: precision=${p.toFixed(2)} recall=${r.toFixed(2)}`
  );
  console.log();
}

main();
