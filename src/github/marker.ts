// Each posted comment carries a hidden fingerprint marker in its body. This is
// how prior comments are matched across pushes without any external storage:
// list the bot's comments, parse the markers, reconcile on fingerprint.

const RE = /<!--\s*ccr:fp=([0-9a-f]+)\s*-->/;

export function embedMarker(fingerprint: string): string {
  return `<!-- ccr:fp=${fingerprint} -->`;
}

export function parseMarker(body: string): string | null {
  const m = RE.exec(body);
  return m ? m[1] : null;
}

export const SUMMARY_MARKER = "<!-- ccr:summary -->";

export function isSummaryComment(body: string): boolean {
  return body.includes(SUMMARY_MARKER);
}
