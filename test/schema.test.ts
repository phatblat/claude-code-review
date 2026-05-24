import { describe, it, expect } from "vitest";
import { parseCandidates, parseVerdicts } from "../src/schema.js";

describe("parseCandidates", () => {
  it("parses well-formed JSONL", () => {
    const jsonl = [
      '{"file":"a.ts","line":12,"category":"logic","claim":"x is null when y is empty","severity":"important"}',
      '{"file":"b.ts","line":3,"category":"security","claim":"raw input lands in query","severity":"nit"}',
    ].join("\n");
    const { ok, errors } = parseCandidates(jsonl);
    expect(errors).toEqual([]);
    expect(ok).toHaveLength(2);
    expect(ok[0].file).toBe("a.ts");
    expect(ok[1].severity).toBe("nit");
  });

  it("skips malformed lines but keeps good ones", () => {
    const jsonl = [
      '{"file":"a.ts","line":1,"category":"logic","claim":"c","severity":"important"}',
      "this is not json",
      '{"file":"b.ts","line":2,"category":"logic","claim":"c","severity":"nit"}',
    ].join("\n");
    const { ok, errors } = parseCandidates(jsonl);
    expect(ok).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/line 2/);
  });

  it("rejects records with bad fields", () => {
    const jsonl = [
      '{"file":"a.ts","line":0,"category":"logic","claim":"c","severity":"important"}', // line < 1
      '{"file":"a.ts","line":5,"category":"logic","claim":"c","severity":"blocker"}', // bad severity
      '{"line":5,"category":"logic","claim":"c","severity":"nit"}', // missing file
    ].join("\n");
    const { ok, errors } = parseCandidates(jsonl);
    expect(ok).toHaveLength(0);
    expect(errors).toHaveLength(3);
  });

  it("tolerates code fences and blank lines", () => {
    const jsonl =
      '```json\n\n{"file":"a.ts","line":1,"category":"logic","claim":"c","severity":"nit"}\n\n```';
    const { ok } = parseCandidates(jsonl);
    expect(ok).toHaveLength(1);
  });
});

describe("parseVerdicts", () => {
  const valid = {
    verdict: "confirmed",
    file: "a.ts",
    line: 10,
    category: "logic",
    severity: "important",
    confidence: 0.9,
    evidence: "a.ts:10 dereferences user before the null check at a.ts:4",
    suggestion: "if (!user) return;",
  };

  it("parses a JSON array", () => {
    const { ok, errors } = parseVerdicts(JSON.stringify([valid, { ...valid, verdict: "rejected" }]));
    expect(errors).toEqual([]);
    expect(ok).toHaveLength(2);
    expect(ok[1].verdict).toBe("rejected");
  });

  it("accepts a single object", () => {
    const { ok } = parseVerdicts(JSON.stringify(valid));
    expect(ok).toHaveLength(1);
  });

  it("falls back to JSONL when not a JSON array", () => {
    const text = [JSON.stringify(valid), JSON.stringify({ ...valid, line: 11 })].join("\n");
    const { ok } = parseVerdicts(text);
    expect(ok).toHaveLength(2);
  });

  it("accepts null suggestion but rejects non-string/non-null", () => {
    const okRes = parseVerdicts(JSON.stringify([{ ...valid, suggestion: null }]));
    expect(okRes.ok).toHaveLength(1);
    expect(okRes.ok[0].suggestion).toBeNull();

    const badRes = parseVerdicts(JSON.stringify([{ ...valid, suggestion: 42 }]));
    expect(badRes.ok).toHaveLength(0);
    expect(badRes.errors).toHaveLength(1);
  });

  it("rejects out-of-range confidence", () => {
    const { ok, errors } = parseVerdicts(JSON.stringify([{ ...valid, confidence: 1.5 }]));
    expect(ok).toHaveLength(0);
    expect(errors[0]).toMatch(/confidence/);
  });
});
