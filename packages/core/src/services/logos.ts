/**
 * Logo.dev — CDN images use the publishable key; search uses the secret key.
 * https://www.logo.dev/docs
 */

const SEARCH_URL = "https://api.logo.dev/v2/search";

export interface LogoSearchHit {
  name: string;
  domain: string;
  logoUrl: string;
}

export function normalizeDomain(raw: string | null | undefined): string | null {
  const domain = (raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!domain || !domain.includes(".") || domain.includes(" ")) return null;
  return domain;
}

export function cdnLogoUrl(domain: string, size = 128): string | null {
  const key = process.env.LOGO_DEV_PUBLISHABLE_KEY?.trim();
  const host = normalizeDomain(domain);
  if (!key || !host) return null;
  return `https://img.logo.dev/${host}?token=${encodeURIComponent(key)}&format=png&size=${size}&retina=true`;
}

export function parseSearchHits(body: unknown): LogoSearchHit[] {
  const data =
    body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : body;
  if (!Array.isArray(data)) return [];
  const hits: LogoSearchHit[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const domain = typeof rec.domain === "string" ? normalizeDomain(rec.domain) : null;
    const signed = typeof rec.logo_url === "string" ? rec.logo_url : null;
    const logoUrl = signed || (domain ? cdnLogoUrl(domain) : null);
    if (!name || !domain || !logoUrl) continue;
    hits.push({ name, domain, logoUrl });
  }
  return hits;
}

export async function searchLogos(
  q: string,
  method: "match" | "typeahead" = "match",
  limit = 8,
): Promise<LogoSearchHit[]> {
  const key = process.env.LOGO_DEV_SECRET_KEY?.trim();
  const query = q.trim();
  if (!key || query.length < 2) return [];
  const url = new URL(SEARCH_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("method", method);
  url.searchParams.set("limit", String(Math.min(25, Math.max(1, limit))));
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      "User-Agent": "VentureLabs/1.0",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) return [];
  return parseSearchHits(await res.json());
}

/** Fill a missing domain from a name search, and always attach a CDN logo when a domain is known. */
export async function resolveCompanyLogo(input: {
  name: string;
  domain?: string | null;
}): Promise<{ domain: string | null; logoUrl: string | null }> {
  const domain = normalizeDomain(input.domain);
  if (domain) return { domain, logoUrl: cdnLogoUrl(domain) };
  try {
    const [hit] = await searchLogos(input.name, "match", 1);
    if (!hit) return { domain: null, logoUrl: null };
    return { domain: hit.domain, logoUrl: hit.logoUrl };
  } catch {
    return { domain: null, logoUrl: null };
  }
}
