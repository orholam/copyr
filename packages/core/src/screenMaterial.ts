const PLACEHOLDER =
  /example domain|illustrative examples|this domain is for use in|buy this domain|domain (?:is )?for sale|parked domain|coming soon|under construction/i;

/** True when website text is a registrar placeholder, parked page, or docs example — not a company. */
export function isPlaceholderCopy(text: string): boolean {
  return PLACEHOLDER.test(text);
}

export function explainEnrichmentSkip(domain: string | null | undefined, detail: string | null | undefined): string {
  const site = domain?.trim() || "this company";
  if ((detail ?? "").trim() === "nothing to fill") {
    return `${site} is already filled in. Parallel only writes empty fields, and it found nothing new to add.`;
  }
  return `Couldn't enrich ${site} — ${humanizeEnrichDetail(detail)}.`;
}

function humanizeEnrichDetail(detail: string | null | undefined): string {
  const d = (detail ?? "").trim();
  if (!d || d === "no content") return "the website didn't have anything we could use";
  if (d === "no domain") return "no website is on file";
  if (d === "nothing to fill") return "Parallel found nothing new to add";
  if (d === "company not found") return "the company record disappeared";
  if (d.startsWith("fetch")) return "the website didn't respond";
  if (d === "PARALLEL_API_KEY is not set") return "company research is not configured";
  if (d.startsWith("Parallel")) return "company research didn't finish";
  return d;
}

/**
 * When this returns a reason, Thesis Screener must not invent a score.
 * `silent` means a website is on file, so the enricher already explains the outcome.
 */
export function thesisSkipReason(input: {
  domain: string | null;
  description: string | null;
  documentChars: number;
}): { reason: string; silent: boolean } | null {
  if (input.documentChars > 80) return null;
  const desc = (input.description ?? "").trim();
  if (desc.length >= 40 && !isPlaceholderCopy(desc)) return null;
  if (input.domain?.trim()) {
    return {
      silent: true,
      reason: `Thesis screening did not run — ${input.domain.trim()} didn't yield enough to score.`,
    };
  }
  return {
    silent: false,
    reason: "Thesis screening did not run — there's no website, deck, or description to score yet.",
  };
}

/** Workflow `eq` that treats boolean true and the string "true" as the same value. */
export function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (isBoolish(actual) || isBoolish(expected)) {
    return boolish(actual) === boolish(expected);
  }
  return normalize(actual) === normalize(expected);
}

function isBoolish(v: unknown): boolean {
  return typeof v === "boolean" || v === "true" || v === "false";
}

function boolish(v: unknown): boolean {
  return v === true || v === "true";
}

function normalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v).toString();
  if (typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map(normalize);
  return String(v).toLowerCase();
}
