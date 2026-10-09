/**
 * Parallel Task API (https://docs.parallel.ai) — web research for company enrichment.
 * The key stays in PARALLEL_API_KEY and is never written into the repo.
 */

const PARALLEL_API = "https://api.parallel.ai/v1/tasks/runs";

export interface ParallelFounder {
  name: string;
  title: string;
}

/** Facts the company page actually shows. */
export interface ParallelCompanyProfile {
  description: string;
  sector: string;
  location: string;
  foundedYear: number | null;
  employeeCount: number | null;
  latestRound: string;
  askUsd: number | null;
  valuationUsd: number | null;
  linkedinUrl: string;
  founders: ParallelFounder[];
}

const OUTPUT_SCHEMA = {
  type: "json",
  json_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "description",
      "sector",
      "location",
      "founded_year",
      "employee_count",
      "latest_round",
      "ask_usd",
      "valuation_usd",
      "linkedin_url",
      "founders",
    ],
    properties: {
      description: {
        type: "string",
        description: "What the company does, in 2-3 sentences, from public sources. Empty string if unknown.",
      },
      sector: {
        type: "string",
        description: "Short industry label, such as Climate, Dev Tools, or Healthcare. Empty string if unknown.",
      },
      location: {
        type: "string",
        description: "Headquarters as City, Region. Empty string if unknown.",
      },
      founded_year: {
        type: ["integer", "null"],
        description: "Four-digit founding year, or null if unknown.",
      },
      employee_count: {
        type: ["integer", "null"],
        description: "Approximate current employee count as an integer, or null if unknown.",
      },
      latest_round: {
        type: "string",
        description:
          "Latest known round in plain language, such as Seed or $2.3B Series D. Empty string if unknown. Do not guess.",
      },
      ask_usd: {
        type: ["integer", "null"],
        description:
          "Amount they are raising now, in USD, only when a current fundraise is stated. Null if unknown. Do not reuse a past round size.",
      },
      valuation_usd: {
        type: ["integer", "null"],
        description: "Last known valuation in USD, or null if unknown.",
      },
      linkedin_url: {
        type: "string",
        description: "Company LinkedIn URL, or empty string if unknown.",
      },
      founders: {
        type: "array",
        description: "Founders or co-founders named in public sources. Empty array if unknown.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "title"],
          properties: {
            name: { type: "string", description: "Full name" },
            title: { type: "string", description: "Role, such as CEO, or empty string." },
          },
        },
      },
    },
  },
};

const INPUT_SCHEMA = {
  type: "json",
  json_schema: {
    type: "object",
    required: ["company_name", "company_website"],
    properties: {
      company_name: { type: "string", description: "The company to research" },
      company_website: { type: "string", description: "The company website or domain" },
    },
  },
};

export function parallelApiKey(): string | null {
  const key = process.env.PARALLEL_API_KEY?.trim();
  return key ? key : null;
}

export function parseParallelProfile(content: unknown): ParallelCompanyProfile | null {
  if (!content || typeof content !== "object") return null;
  const row = content as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const year = intInRange(row.founded_year, 1800, 2100);
  const employees = intInRange(row.employee_count, 1, 5_000_000);
  const profile: ParallelCompanyProfile = {
    description: text(row.description).slice(0, 2000),
    sector: text(row.sector).slice(0, 80),
    location: text(row.location).slice(0, 120),
    foundedYear: year,
    employeeCount: employees,
    latestRound: text(row.latest_round).slice(0, 160),
    askUsd: intInRange(row.ask_usd, 1, 1_000_000_000_000),
    valuationUsd: intInRange(row.valuation_usd, 1, 10_000_000_000_000),
    linkedinUrl: cleanHttpUrl(row.linkedin_url),
    founders: parseFounders(row.founders),
  };
  const hasFact =
    profile.description ||
    profile.sector ||
    profile.location ||
    profile.latestRound ||
    profile.linkedinUrl ||
    profile.foundedYear != null ||
    profile.employeeCount != null ||
    profile.askUsd != null ||
    profile.valuationUsd != null ||
    profile.founders.length > 0;
  if (!hasFact) return null;
  return profile;
}

function cleanHttpUrl(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString().slice(0, 300);
  } catch {
    return "";
  }
}

function parseFounders(value: unknown): ParallelFounder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const founders: ParallelFounder[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 120) : "";
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 80) : "";
    founders.push({ name, title });
    if (founders.length >= 8) break;
  }
  return founders;
}

function intInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export async function researchCompany(input: {
  name: string;
  domain: string;
}): Promise<{ profile: ParallelCompanyProfile } | { error: string }> {
  const apiKey = parallelApiKey();
  if (!apiKey) return { error: "PARALLEL_API_KEY is not set" };

  const processor = process.env.PARALLEL_PROCESSOR?.trim() || "core";
  let runId: string;
  try {
    const created = await parallelFetch(apiKey, PARALLEL_API, {
      method: "POST",
      body: JSON.stringify({
        processor,
        input: { company_name: input.name, company_website: input.domain },
        task_spec: { input_schema: INPUT_SCHEMA, output_schema: OUTPUT_SCHEMA },
      }),
    });
    const id = created.run_id;
    if (typeof id !== "string" || !id) return { error: "Parallel did not return a run id" };
    runId = id;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Parallel request failed" };
  }

  try {
    const result = await parallelFetch(apiKey, `${PARALLEL_API}/${runId}/result?timeout=90`, {
      method: "GET",
      timeoutMs: 100_000,
    });
    const output = result.output;
    const content =
      output && typeof output === "object" && "content" in output
        ? (output as { content?: unknown }).content
        : output;
    const profile = parseParallelProfile(content);
    if (!profile) return { error: "Parallel returned no company profile" };
    return { profile };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Parallel result failed" };
  }
}

async function parallelFetch(
  apiKey: string,
  url: string,
  init: { method: string; body?: string; timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: init.method,
    headers: {
      "x-api-key": apiKey,
      Accept: "application/json",
      "User-Agent": "VentureLabs/1.0",
      "content-type": "application/json",
    },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const message = typeof body.message === "string" ? body.message : text.slice(0, 180);
    throw new Error(`Parallel ${res.status}${message ? `: ${message}` : ""}`);
  }
  return body;
}
