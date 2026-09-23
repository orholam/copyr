import { z } from "zod";
import {
  deckExtractionSchema,
  emailTriageSchema,
  updateClassificationSchema,
  type AiProvider,
  type DeckExtraction,
  type EmailTriage,
  type ThesisScoreOutput,
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
  // Object spread copies only own enumerable properties. Class providers
  // (MockProvider, OpenAiCompatibleProvider) keep assistantTurn / answerGrounded /
  // extractTableRows / scoreThesis on the prototype, so `{ ...provider }` drops
  // them and chat SSE fails with `ctx.ai.assistantTurn is not a function`.
  // Object.create keeps the prototype chain, then we override the four
  // contract-normalized methods as own properties.
  const wrapped = Object.create(provider) as AiProvider;
  wrapped.extractDeck = async (text, fieldSpecs) =>
    normalizeDeck(await provider.extractDeck(text, fieldSpecs));
  wrapped.triageEmail = async (input) =>
    normalizeTriage(await provider.triageEmail(input));
  wrapped.classifyUpdate = async (text) =>
    normalizeUpdateClassification(await provider.classifyUpdate(text));
  wrapped.generateThesis = async (input) => {
    const out = await provider.generateThesis(input);
    return {
      memo: typeof out?.memo === "string" && out.memo.trim() ? out.memo : `(no memo generated)`,
      confidence: typeof out?.confidence === "number" ? Math.min(1, Math.max(0, out.confidence)) : 0.5,
    };
  };
  wrapped.scoreThesis = async (input) => normalizeThesisScore(await provider.scoreThesis(input));
  return wrapped;
}

const RECS = ["advance", "watch", "pass"] as const;

function normalizeThesisScore(raw: unknown): ThesisScoreOutput {
  const r = (raw ?? {}) as Record<string, unknown>;
  let rec = String(r.recommendation ?? "watch").toLowerCase();
  let fit =
    typeof r.fitScore === "number" && Number.isFinite(r.fitScore)
      ? Math.max(0, Math.min(100, Math.round(r.fitScore)))
      : 50;
  const asStrings = (v: unknown) =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 12)
      : [];
  const reasons = asStrings(r.reasons);
  const concerns = asStrings(r.concerns);
  // Never auto-pass on thin material: upgrade low-signal passes to watch
  if (rec === "pass" && reasons.length === 0 && concerns.some((c) => /little material|insufficient|needs enrichment/i.test(c))) {
    rec = "watch";
    fit = Math.max(fit, 45);
  }
  if (rec === "pass" && reasons.length === 0 && fit < 40) {
    rec = "watch";
    fit = Math.max(fit, 45);
  }
  return {
    fitScore: fit,
    recommendation: (RECS as readonly string[]).includes(rec) ? (rec as ThesisScoreOutput["recommendation"]) : "watch",
    reasons,
    concerns,
    summary:
      typeof r.summary === "string" && r.summary.trim()
        ? r.summary.trim().slice(0, 800)
        : "Thesis screen completed.",
    confidence:
      typeof r.confidence === "number" && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(1, r.confidence))
        : 0.7,
  };
}
