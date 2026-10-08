export interface ParsedRound {
  roundStage: string | null;
  askAmount: number | null;
  valuation: number | null;
}

const STAGE_PATTERNS: Array<[RegExp, string]> = [
  [/series\s*d\b/i, "Series D+"],
  [/series\s*c\b/i, "Series C"],
  [/series\s*b\b/i, "Series B"],
  [/series\s*a\b/i, "Series A"],
  [/pre-?\s*seed/i, "Pre-seed"],
  [/\bseed\b/i, "Seed"],
];

function scale(amount: string, suffix: string | undefined): number {
  const n = Number(amount.replace(/,/g, ""));
  const mult = suffix ? { k: 1e3, m: 1e6, b: 1e9 }[suffix.toLowerCase()] ?? 1 : 1;
  return n * mult;
}

interface MoneyHit {
  value: number;
  start: number;
  end: number;
}

function moneyHits(text: string): MoneyHit[] {
  const re = /\$\s*(\d+(?:\.\d+)?)\s*([kmb])?|(?:^|[^\d.$])(\d+(?:\.\d+)?)\s*([kmb])\b/gi;
  const hits: MoneyHit[] = [];
  for (const m of text.matchAll(re)) {
    const amount = m[1] ?? m[3];
    const suffix = m[2] ?? m[4];
    if (!amount) continue;
    if (!m[1] && !suffix) continue;
    const value = scale(amount, suffix);
    if (!Number.isFinite(value)) continue;
    hits.push({ value, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  }
  return hits;
}

/**
 * Pull a stage, a single ask, and a post-money figure out of a free-text round.
 * Ranges and narrative rounds stay unparsed so the original label remains the source of truth.
 */
export function parseRoundLabel(raw: string | null | undefined): ParsedRound {
  const empty: ParsedRound = { roundStage: null, askAmount: null, valuation: null };
  const text = raw?.trim() ?? "";
  if (!text || /^n\/?a$/i.test(text)) return empty;

  let roundStage: string | null = null;
  if (!/^note\b/i.test(text)) {
    for (const [re, name] of STAGE_PATTERNS) {
      if (re.test(text)) {
        roundStage = name;
        break;
      }
    }
  }

  const post = text.match(/on\s+(\$\s*\d+(?:\.\d+)?\s*[kmb]?)\s*post/i);
  let valuation: number | null = null;
  let valuationSpan: [number, number] | null = null;
  if (post?.index != null && post[1]) {
    const inner = moneyHits(post[1]);
    if (inner[0]) {
      valuation = inner[0].value;
      const at = text.indexOf(post[1], post.index);
      valuationSpan = [at, at + post[1].length];
    }
  }

  const hits = moneyHits(text).filter((h) => {
    if (!valuationSpan) return true;
    return h.end <= valuationSpan[0] || h.start >= valuationSpan[1];
  });

  const ranged = /[-–]|to\s+\d/i.test(text) && hits.length >= 2 && !/followed by/i.test(text);
  const beforeFutureRound = /\bbefore\b/i.test(text);
  let askAmount: number | null = null;
  if (!ranged && !beforeFutureRound && hits.length >= 1) {
    askAmount = hits[0]!.value;
  }

  return { roundStage, askAmount, valuation };
}
