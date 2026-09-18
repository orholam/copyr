import { z } from "zod";
import type { FieldType } from "@copyr/contracts";

/** A workspace custom field the extractor should try to fill. */
export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  options?: string[] | null;
}

export const companyExtractionSchema = z
  .object({
    name: z.string().nullish(),
    domain: z.string().nullish(),
    sector: z.string().nullish(),
    location: z.string().nullish(),
    description: z.string().nullish(),
    foundedYear: z.number().int().min(1900).max(2100).nullish(),
    employeeCount: z.number().int().min(0).nullish(),
  })
  .partial();

export const dealExtractionSchema = z
  .object({
    roundStage: z.string().nullish(),
    askAmountUsd: z.number().nullish(),
    summary: z.string().max(600).nullish(),
  })
  .partial();

export const deckExtractionSchema = z.object({
  company: companyExtractionSchema,
  deal: dealExtractionSchema,
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])),
  confidence: z.number().min(0).max(1),
});
export type DeckExtraction = z.infer<typeof deckExtractionSchema>;

export const emailCompanySchema = z.object({
  name: z.string(),
  domain: z.string().nullish(),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const emailTriageSchema = z.object({
  intent: z.enum(["fundraise", "portfolio_update", "warm_intro", "other"]),
  companies: z.array(emailCompanySchema).max(200),
  isPortfolioUpdate: z.boolean(),
  updateTitle: z.string().nullish(),
  summary: z.string().max(500),
  confidence: z.number().min(0).max(1),
});
export type EmailTriage = z.infer<typeof emailTriageSchema>;

export const updateClassificationSchema = z.object({
  kind: z.enum(["milestone", "metric", "hiring", "funding", "news", "update"]),
  title: z.string().max(160),
});
export type UpdateClassification = z.infer<typeof updateClassificationSchema>;

export interface ThesisInput {
  companyName: string;
  sector?: string | null;
  description?: string | null;
  location?: string | null;
  roundStage?: string | null;
  askAmount?: number | null;
  sourceText: string;
}

export interface ThesisMemoOutput {
  memo: string;
  confidence: number;
}

/* ── grounded research (cited Q&A over workspace corpus) ───────────── */

export interface GroundingPassage {
  id: string;
  sourceType: "document" | "note" | "portfolio_update" | "email" | "memory";
  sourceName: string;
  text: string;
}

export interface GroundedAnswer {
  answer: string;
  /** indexes into the passages array that the answer relies on */
  citations: number[];
  confidence: number;
}

/* ── vault review tables (structured extraction across documents) ─── */

export interface ReviewColumnSpec {
  key: string;
  label: string;
  type: "text" | "number" | "currency" | "date" | "boolean";
  description?: string;
}

export interface ReviewDocumentInput {
  id: string;
  name: string;
  text: string;
}

export interface ReviewRowOutput {
  documentId: string;
  data: Record<string, string | number | boolean | null>;
  citations: string[];
  confidence: number;
}

export interface ReviewExtractionOutput {
  rows: ReviewRowOutput[];
}

/* ── thesis screening (codified fund judgment) ────────────────────── */

export interface ThesisScoreInput {
  agentName: string;
  instructions?: string | null;
  mustHaveKeywords?: string[];
  excludeKeywords?: string[];
  companyName: string;
  sector?: string | null;
  roundStage?: string | null;
  askAmount?: number | null;
  sourceText: string;
}

export interface ThesisScoreOutput {
  fitScore: number; // 0-100
  recommendation: "advance" | "watch" | "pass";
  reasons: string[];
  concerns: string[];
  summary: string;
  confidence: number;
}

/* ── assistant (central chat over product tools) ──────────────────── */

export interface AssistantToolSpec {
  name: string;
  description: string;
  /** JSON Schema for arguments (from MCP `inputSchema`), when known. */
  inputSchema?: Record<string, unknown>;
}

export interface AssistantTurnMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface AssistantTurnInput {
  messages: AssistantTurnMessage[];
  tools: AssistantToolSpec[];
}

export interface AssistantToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface AssistantTurnResult {
  /** final reply for the user; null when another tool round is needed */
  reply: string | null;
  toolCalls: AssistantToolCall[];
  confidence: number;
}

/* ── provider interface ────────────────────────────────────────────── */

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Extract structured data from deck text into workspace field specs. */
  extractDeck(text: string, fieldSpecs: FieldSpec[]): Promise<DeckExtraction>;
  /** Triage an inbound email: intent + companies mentioned. */
  triageEmail(input: {
    subject: string;
    fromEmail: string;
    bodyText: string;
    knownCompanyNames: string[];
  }): Promise<EmailTriage>;
  classifyUpdate(text: string): Promise<UpdateClassification>;
  /** Draft an internal investment memo for a company. */
  generateThesis(input: ThesisInput): Promise<ThesisMemoOutput>;
  /** Answer a question grounded ONLY in the supplied passages; cite passage indexes. */
  answerGrounded(input: { question: string; passages: GroundingPassage[] }): Promise<GroundedAnswer>;
  /** Extract structured rows from a set of documents per column spec. */
  extractTableRows(input: {
    instruction?: string | null;
    columns: ReviewColumnSpec[];
    documents: ReviewDocumentInput[];
  }): Promise<ReviewExtractionOutput>;
  /** Score a company against a codified fund thesis. */
  scoreThesis(input: ThesisScoreInput): Promise<ThesisScoreOutput>;
  /**
   * One assistant turn: decide tool calls or produce the final reply.
   * The host executes requested tools and feeds results back as `tool` messages.
   */
  assistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult>;
}

export class AiError extends Error {}
