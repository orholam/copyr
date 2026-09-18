import { loadConfig } from "@copyr/config";
import {
  AiError,
  type AssistantTurnInput,
  type AssistantTurnResult,
  type AiProvider,
  type DeckExtraction,
  type EmailTriage,
  type FieldSpec,
  type GroundedAnswer,
  type GroundingPassage,
  type ReviewColumnSpec,
  type ReviewDocumentInput,
  type ReviewExtractionOutput,
  type ThesisInput,
  type ThesisMemoOutput,
  type ThesisScoreInput,
  type ThesisScoreOutput,
  type UpdateClassification,
} from "./types.js";
import { formatToolCatalog, normalizeAssistantToolCalls } from "./assistant-tools.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Any OpenAI-compatible endpoint (OpenAI, Bedrock gateway, vLLM, OpenRouter).
 * Uses JSON-schema structured output; falls back to lenient JSON parsing.
 */

const EMAIL_TRIAGE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "companies", "isPortfolioUpdate", "summary", "confidence"],
  properties: {
    intent: { type: "string", enum: ["fundraise", "portfolio_update", "warm_intro", "other"] },
    companies: {
      type: "array",
      maxItems: 200,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "confidence"],
        properties: {
          name: { type: "string" },
          domain: { type: ["string", "null"] },
          confidence: { type: "number" },
        },
      },
    },
    isPortfolioUpdate: { type: "boolean" },
    updateTitle: { type: ["string", "null"] },
    summary: { type: "string" },
    confidence: { type: "number" },
  },
} as const;

const ASSISTANT_TURN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: true,
  properties: {
    reply: { type: ["string", "null"] },
    toolCalls: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: true,
        required: ["name"],
        properties: {
          name: { type: "string" },
          args: { type: "object", additionalProperties: true },
          arguments: { type: ["object", "string"] },
        },
      },
    },
  },
} as const;

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai";
  readonly model: string;
  private baseUrl: string;
  private apiKey?: string;

  constructor(opts?: { model?: string; baseUrl?: string; apiKey?: string }) {
    const cfg = loadConfig();
    this.model = opts?.model ?? cfg.AI_MODEL;
    this.baseUrl = (opts?.baseUrl ?? cfg.OPENAI_BASE_URL).replace(/\/$/, "");
    this.apiKey = opts?.apiKey ?? cfg.OPENAI_API_KEY;
    if (!this.apiKey) throw new AiError("OPENAI_API_KEY required for AI_PROVIDER=openai");
  }

  private async structured<T>(schemaName: string, schema: object, messages: ChatMessage[]): Promise<T> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: schemaName, strict: false, schema },
        },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new AiError(`LLM provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new AiError("Empty completion");
    try {
      return JSON.parse(content) as T;
    } catch {
      // tolerate fenced or trailing text
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new AiError(`Unparseable completion: ${content.slice(0, 200)}`);
      return JSON.parse(match[0]) as T;
    }
  }

  async extractDeck(text: string, fieldSpecs: FieldSpec[]): Promise<DeckExtraction> {
    const fieldInstructions = fieldSpecs
      .map(
        (f) =>
          `- key=${f.key} label="${f.label}" type=${f.type}` +
          (f.options?.length ? ` options=[${f.options.join("|")}]` : ""),
      )
      .join("\n");
    return this.structured<DeckExtraction>(
      "deck_extraction",
      zodLikeJsonSchema(),
      [
        {
          role: "system",
          content:
            "You are a VC analyst AI. Extract structured deal data from pitch decks. " +
            "Only include values you can support from the text; use null otherwise. " +
            "For select fields choose ONLY from the provided options.",
        },
        {
          role: "user",
          content: `Custom fields to extract:\n${fieldInstructions}\n\nDeck text:\n"""\n${text.slice(0, 24_000)}\n"""`,
        },
      ],
    );
  }

  async triageEmail(input: {
    subject: string;
    fromEmail: string;
    bodyText: string;
    knownCompanyNames: string[];
  }): Promise<EmailTriage> {
    const raw = await this.structured<EmailTriage>(
      "email_triage",
      EMAIL_TRIAGE_JSON_SCHEMA,
      [
        {
          role: "system",
          content:
            "You triage inbound VC deal-flow emails. Rules:\n" +
            "1. List ONLY companies this specific email is actually about or explicitly introduces. Never pad with CRM companies that are not genuinely referenced.\n" +
            "2. The sender's own company (from their signature/domain) counts as mentioned.\n" +
            "3. intent must be exactly one of: fundraise | portfolio_update | warm_intro | other.\n" +
            "4. Always provide a one-sentence summary of THIS email.\n" +
            "5. Bulk forwards may mention up to 200 companies; only include those truly present.",
        },
        {
          role: "user",
          content: `Known companies in CRM: ${input.knownCompanyNames.slice(0, 500).join(", ") || "(none)"}\nFrom: ${input.fromEmail}\nSubject: ${input.subject}\n\nBody:\n${input.bodyText.slice(0, 12_000)}`,
        },
      ],
    );

    // Deterministic anti-hallucination filter: a company stays only if its
    // name literally appears in the subject/body, or its domain matches the
    // sender's own domain.
    const haystack = `${input.subject}\n${input.bodyText}`.toLowerCase();
    const senderDomain = input.fromEmail.split("@")[1]?.toLowerCase().replace(/^www\./, "");
    const knownSet = new Set(input.knownCompanyNames.map((n) => n.toLowerCase()));
    raw.companies = (raw.companies ?? []).filter((c) => {
      const name = String(c?.name ?? "").trim();
      if (name.length < 2) return false;
      const literal = haystack.includes(name.toLowerCase());
      const rootDomain = senderDomain?.split(".")[0];
      const ownDomain = !!c.domain && !!rootDomain && String(c.domain).toLowerCase().includes(rootDomain);
      const knownMentioned = knownSet.has(name.toLowerCase()) && literal;
      return literal || ownDomain || knownMentioned;
    });
    if (!raw.companies.length && senderDomain && !["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "proton.me"].includes(senderDomain)) {
      // never lose a lead — fall back to the sender-domain guess
      raw.companies = [{
        name: senderDomain.split(".")[0]!.replace(/[-_]/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
        domain: senderDomain,
        confidence: 0.75,
      }];
    }
    if (!raw.summary || !String(raw.summary).trim()) {
      raw.summary = `${input.subject} — from ${input.fromEmail}`;
    }
    return raw;
  }

  async generateThesis(input: ThesisInput): Promise<ThesisMemoOutput> {
    const res = await this.structured<{ memo: string; confidence?: number }>(
      "investment_thesis",
      zodLikeJsonSchema(),
      [
        {
          role: "system",
          content:
            "You are a VC associate drafting a concise internal investment memo (markdown). " +
            "Sections: What they do / Why it fits / Key risks / Suggested next steps. " +
            "Only use facts present in the provided material; flag unknowns explicitly.",
        },
        {
          role: "user",
          content: `Company: ${input.companyName}\nSector: ${input.sector ?? "?"}\nLocation: ${input.location ?? "?"}\nRound: ${input.roundStage ?? "?"}\nAsk: ${input.askAmount ?? "?"}\n\nMaterial:\n${input.sourceText.slice(0, 12_000)}`,
        },
      ],
    );
    if (typeof res.memo !== "string" || !res.memo.trim()) {
      throw new AiError(`investment_thesis returned no memo: ${JSON.stringify(res).slice(0, 200)}`);
    }
    return { memo: res.memo, confidence: clamp01(res.confidence, 0.8) };
  }

  async classifyUpdate(text: string): Promise<UpdateClassification> {
    return this.structured<UpdateClassification>(
      "update_classification",
      zodLikeJsonSchema(),
      [
        { role: "system", content: "Classify a portfolio company update." },
        { role: "user", content: text.slice(0, 8_000) },
      ],
    );
  }

  async answerGrounded(input: {
    question: string;
    passages: GroundingPassage[];
  }): Promise<GroundedAnswer> {
    const numbered = input.passages
      .map((p, i) => `[${i}] (${p.sourceType}) ${p.sourceName}: ${p.text.slice(0, 2_400)}`)
      .join("\n---\n");
    const res = await this.structured<GroundedAnswer>(
      "grounded_answer",
      {
        type: "object",
        properties: {
          answer: { type: "string", description: "The final markdown answer" },
          citations: { type: "array", items: { type: "integer" }, description: "Passage indexes relied on" },
          confidence: { type: "number", description: "0-1" },
        },
        required: ["answer", "citations", "confidence"],
      },
      [
        {
          role: "system",
          content:
            "You answer VC diligence questions using ONLY the numbered passages supplied. " +
            "Cite the passage indexes you relied on in `citations`. If the passages do not " +
            "contain the answer, say so explicitly in `answer` and return an empty citations array. Be concise and factual.",
        },
        { role: "user", content: `Question: ${input.question}\n\nPassages:\n${numbered.slice(0, 40_000)}` },
      ],
    );

    const answer = typeof res?.answer === "string" ? res.answer : "";
    if (!answer.trim()) {
      throw new AiError(
        `grounded_answer returned no answer field: ${JSON.stringify(res).slice(0, 200)}`,
      );
    }
    return {
      answer,
      citations: (res.citations ?? []).filter(
        (i) => Number.isInteger(i) && (i as number) >= 0 && (i as number) < input.passages.length,
      ) as number[],
      confidence: clamp01(res.confidence ?? 0.7),
    };
  }

  async extractTableRows(input: {
    instruction?: string | null;
    columns: ReviewColumnSpec[];
    documents: ReviewDocumentInput[];
  }): Promise<ReviewExtractionOutput> {
    const colSpec = input.columns
      .map((c) => `- key="${c.key}" label="${c.label}" type=${c.type}${c.description ? ` (${c.description})` : ""}`)
      .join("\n");
    const docs = input.documents
      .map((d, i) => `[[doc ${i}]] id=${d.id} name=${d.name}\n${d.text.slice(0, 6_000)}`)
      .join("\n====\n");
    const res = await this.structured<ReviewExtractionOutput>(
      "review_table_extraction",
      zodLikeJsonSchema(),
      [
        {
          role: "system",
          content:
            "You extract one row per document for a VC diligence review table. For each document, " +
            "fill every column with a value from the document text or null when absent. Include short " +
            "verbatim quotes (≤200 chars) supporting the extracted values.",
        },
        {
          role: "user",
          content:
            `Columns:\n${colSpec}\n${input.instruction ? `Instruction: ${input.instruction}\n` : ""}\nDocuments:\n${docs.slice(0, 60_000)}`,
        },
      ],
    );
    const ids = new Set(input.documents.map((d) => d.id));
    return {
      rows: (res.rows ?? [])
        .filter((r) => r && ids.has(r.documentId))
        .map((r) => ({
          documentId: r.documentId,
          data: r.data ?? {},
          citations: Array.isArray(r.citations) ? r.citations.slice(0, 4).map(String) : [],
          confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.7,
        })),
    };
  }

  async scoreThesis(input: ThesisScoreInput): Promise<ThesisScoreOutput> {
    return this.structured<ThesisScoreOutput>(
      "thesis_screen",
      zodLikeJsonSchema(),
      [
        {
          role: "system",
          content:
            "You are screening a company against a fund's codified investment thesis. " +
            "Return fitScore 0-100, recommendation advance|watch|pass, concrete reasons and concerns, " +
            "and a two-sentence summary. Ground every claim in the provided material; say \"not stated\" where unknown.",
        },
        {
          role: "user",
          content:
            `Fund thesis agent "${input.agentName}"${input.instructions ? `\nInstructions: ${input.instructions}` : ""}` +
            `${input.mustHaveKeywords?.length ? `\nMust-have themes: ${input.mustHaveKeywords.join(", ")}` : ""}` +
            `${input.excludeKeywords?.length ? `\nExcluded themes: ${input.excludeKeywords.join(", ")}` : ""}\n` +
            `Company: ${input.companyName}\nSector: ${input.sector ?? "?"} Round: ${input.roundStage ?? "?"} Ask: ${input.askAmount ?? "?"}\n\n` +
            `Material:\n${input.sourceText.slice(0, 12_000)}`,
        },
      ],
    );
  }

  async assistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
    const toolLines = formatToolCatalog(input.tools);
    const transcript = input.messages
      .map((m) => {
        if (m.role === "tool") return `[tool result]\n${m.content.slice(0, 4_000)}`;
        if (m.role === "assistant") return `[assistant] ${m.content}`;
        return `[user] ${m.content}`;
      })
      .join("\n\n")
      .slice(-40_000);

    const res = await this.structured<{ reply?: string | null; toolCalls?: unknown }>(
      "assistant_turn",
      ASSISTANT_TURN_JSON_SCHEMA,
      [
        {
          role: "system",
          content:
            "You are the Copyr Assistant — the central chat interface of a VC operating platform. " +
            "You can call product tools to answer. Respond with JSON: either " +
            "{\"toolCalls\": [{\"name\": \"create_company\", \"args\": {\"name\": \"Acme\"}}]} " +
            "to run one round of tools (max 2), or {\"reply\": \"...\"} as the final markdown answer. " +
            "Always fill every required argument listed in the catalog (never call a required-arg tool with empty args). " +
            "If a tool result reports missing arguments, retry once with those fields populated from the conversation. " +
            "Prefer tools over guessing; cite what results actually say; be concise.\n" +
            "Reply formatting rules:\n" +
            "- Compact markdown only: **bold company names**, short '- ' bullets, one '###' heading max\n" +
            "- Never echo raw field labels ('Title:', 'Update:', 'Date:', 'Source:', ids) — weave facts into natural lines\n" +
            "- One block per company: name line first, then a detail line\n" +
            "- Dates as 'Aug 21, 2026'; money as '$4.2M'; skip null fields entirely\n" +
            "- Open multi-result answers with one short lead-in sentence",
        },
        { role: "user", content: `Available tools:\n${toolLines}\n\nConversation:\n${transcript}` },
      ],
    );

    const allowed = new Set(input.tools.map((t) => t.name));
    const calls = normalizeAssistantToolCalls(res.toolCalls, allowed);
    return {
      reply: calls.length ? null : res.reply ?? "(no response)",
      toolCalls: calls.slice(0, 2),
      confidence: 0.8,
    };
  }
}

function zodLikeJsonSchema(): object {
  return { type: "object" };
}

function clamp01(n: unknown, fallback = 0.7): number {
  return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}
