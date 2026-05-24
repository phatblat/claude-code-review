// A finding's identity must survive line drift between pushes, so the
// fingerprint deliberately excludes the line number. Two findings are "the
// same issue" if they share file + category + a normalized claim.

export function normalizeClaim(claim: string): string {
  return claim
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** djb2, returned as 8 hex chars. Deterministic and dependency-free. */
export function fingerprint(file: string, category: string, claim: string): string {
  const key = `${file}::${category}::${normalizeClaim(claim)}`;
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
