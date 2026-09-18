import { z } from "zod";
import {
  deckExtractionSchema,
  emailTriageSchema,
  updateClassificationSchema,
  type AiProvider,
  type DeckExtraction,
  type EmailTriage,
  type UpdateClassification,
} from "./types.js";

/**
 * Contract enforcement at the AI boundary. Providers drift — models return
 * "Funding" instead of "fundraise", drop fields, or wrap arrays. Every
 * provider response passes through these normalizers so consumers can rely
 * on the documented shapes.
 */

const INTENT_ALIASES: Record<string, EmailTriage["intent"]> = {
  fundraise: "fundraise",
  fundraising: "fundraise",
  funding: "fundraise",
  raise: "fundraise",
  pitch: "fundraise",
  portfolio_update: "portfolio_update",
  "portfolio update": "portfolio_update",
  update: "portfolio_update",
  warm_intro: "warm_intro",
  intro: "warm_intro",
  introduction: "warm_intro",
  other: "other",
};

const emailTriageLoose = z.object({
  intent: z.unknown().optional(),
  companies: z.unknown().optional(),
  isPortfolioUpdate: z.unknown().optional(),
  updateTitle: z.unknown().optional(),
  summary: z.unknown().optional(),
  confidence: z.unknown().optional(),
});

function normalizeTriage(raw: unknown): EmailTriage {
  const r = emailTriageLoose.safeParse(raw) ? (raw as Record<string, unknown>) : {};
  const rawIntent = String(r.intent ?? "other").toLowerCase().trim();
  const intent = INTENT_ALIASES[rawIntent] ?? "other";

  const companies = Array.isArray(r.companies)
    ? (r.companies as Array<Record<string, unknown>>)
        .filter((c) => c && typeof c.name === "string" && c.name.trim().length > 1)
        .slice(0, 200)
        .map((c) => ({
          name: String(c.name).trim().slice(0, 120),
          domain: typeof c.domain === "string" ? c.domain : null,
          confidence: typeof c.confidence === "number" ? Math.min(1, Math.max(0, c.confidence)) : 0.7,
        }))
    : [];

  return emailTriageSchema.parse({
    intent,
    companies,
    isPortfolioUpdate: Boolean(r.isPortfolioUpdate),
    updateTitle: typeof r.updateTitle === "string" ? r.updateTitle : null,
    summary: typeof r.summary === "string" && r.summary.trim() ? r.summary.slice(0, 500) : "(no summary)",
    confidence: typeof r.confidence === "number" && !Number.isNaN(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0.6,
  });
}

function normalizeDeck(raw: unknown): DeckExtraction {
  const r = (raw ?? {}) as Record<string, unknown>;
  const parsed = deckExtractionSchema.safeParse({
    company: (r.company ?? {}) as Record<string, unknown>,
    deal: (r.deal ?? {}) as Record<string, unknown>,
    fields: typeof r.fields === "object" && r.fields !== null ? r.fields : {},
    confidence: typeof r.confidence === "number" ? r.confidence : 0.5,
  });
  if (parsed.success) {
    const out = parsed.data;
    return {
      ...out,
      confidence: Math.min(1, Math.max(0, out.confidence)),
    };
  }
  return { company: {}, deal: {}, fields: {}, confidence: 0.3 };
}

function normalizeUpdateClassification(raw: unknown): UpdateClassification {
  const r = (raw ?? {}) as Record<string, unknown>;
  const KINDS = ["milestone", "metric", "hiring", "funding", "news", "update"] as const;
  const rawKind = String(r.kind ?? "update").toLowerCase();
  const title = typeof r.title === "string" && r.title.trim() ? r.title : String(raw).slice(0, 140);
  return updateClassificationSchema.parse({
    kind: (KINDS as readonly string[]).includes(rawKind) ? rawKind : "update",
    title: title.replace(/\s+/g, " ").slice(0, 160),
  });
}

/** Wrap any provider with contract normalization. */
export function withContractEnforcement(provider: AiProvider): AiProvider {
  // Pass through any provider capabilities beyond the core four, then
  // override the core methods with contract-normalizing wrappers.
  return {
    ...provider,
    async extractDeck(text, fieldSpecs) {
      return normalizeDeck(await provider.extractDeck(text, fieldSpecs));
    },
    async triageEmail(input) {
      return normalizeTriage(await provider.triageEmail(input));
    },
    async classifyUpdate(text) {
      return normalizeUpdateClassification(await provider.classifyUpdate(text));
    },
    async generateThesis(input) {
      const out = await provider.generateThesis(input);
      return {
        memo: typeof out?.memo === "string" && out.memo.trim() ? out.memo : `(no memo generated)`,
        confidence: typeof out?.confidence === "number" ? Math.min(1, Math.max(0, out.confidence)) : 0.5,
      };
    },
  };
}
