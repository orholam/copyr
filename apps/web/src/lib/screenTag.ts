/** Reserved company tags stamped by Thesis Screener: `screen:advance:72` */

const SCREEN_TAG_RE = /^screen:(advance|watch|pass)(?::(\d{1,3}))?$/i;

export type ScreenRec = "advance" | "watch" | "pass";

export interface ScreenStamp {
  recommendation: ScreenRec;
  fitScore: number | null;
  tag: string;
}

export function formatScreenTag(recommendation: ScreenRec, fitScore: number): string {
  const fit = Math.max(0, Math.min(100, Math.round(fitScore)));
  return `screen:${recommendation}:${fit}`;
}

export function isScreenTag(tag: string): boolean {
  return SCREEN_TAG_RE.test(tag);
}

export function parseScreenTag(tags: string[] | null | undefined): ScreenStamp | null {
  if (!tags?.length) return null;
  for (let i = tags.length - 1; i >= 0; i--) {
    const m = tags[i]!.match(SCREEN_TAG_RE);
    if (!m) continue;
    const recommendation = m[1]!.toLowerCase() as ScreenRec;
    const fitScore = m[2] != null ? Number(m[2]) : null;
    return {
      recommendation,
      fitScore: fitScore != null && Number.isFinite(fitScore) ? fitScore : null,
      tag: tags[i]!,
    };
  }
  return null;
}

export function stripScreenTags(tags: string[]): string[] {
  return tags.filter((t) => !isScreenTag(t));
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
