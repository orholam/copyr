/** Shared with web — stamped on companies by Thesis Screener. */

const SCREEN_TAG_RE = /^screen:(advance|watch|pass)(?::(\d{1,3}))?$/i;

export type ScreenRec = "advance" | "watch" | "pass";

export function formatScreenTag(recommendation: ScreenRec, fitScore: number): string {
  const fit = Math.max(0, Math.min(100, Math.round(fitScore)));
  return `screen:${recommendation}:${fit}`;
}

export function stripScreenTags(tags: string[]): string[] {
  return tags.filter((t) => !SCREEN_TAG_RE.test(t));
}

export function upsertScreenTag(
  tags: string[] | null | undefined,
  recommendation: ScreenRec,
  fitScore: number,
): string[] {
  const next = stripScreenTags(tags ?? []);
  next.push(formatScreenTag(recommendation, fitScore));
  return next;
}
