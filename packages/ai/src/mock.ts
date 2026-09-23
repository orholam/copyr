import { extractCreateCompanyNames, fillMissingToolArgs, missingRequiredArgs } from "./assistant-tools.js";
import type {
  AiProvider,
  AssistantTurnInput,
  AssistantTurnResult,
  DeckExtraction,
  EmailTriage,
  FieldSpec,
  GroundedAnswer,
  GroundingPassage,
  ReviewColumnSpec,
  ReviewDocumentInput,
  ReviewExtractionOutput,
  ThesisInput,
  ThesisMemoOutput,
  ThesisScoreInput,
  ThesisScoreOutput,
  UpdateClassification,
} from "./types.js";

/* Deterministic, offline, free extraction. Good enough to make the entire
 * product pipeline demonstrable without any LLM credentials; real provider
 * slots in behind the same interface. */

const SECTOR_KEYWORDS: Record<string, string[]> = {
  "AI/ML": ["ai", "machine learning", "ml", "llm", "model", "inference", "agent"],
  Fintech: ["fintech", "payments", "treasury", "banking", "lending", "invoice"],
  "Dev Tools": ["developer", "devtools", "kubernetes", "api", "pipeline", "observability", "infra"],
  Health: ["health", "clinic", "medical", "therapeutic", "patient", "care"],
  Climate: ["climate", "carbon", "energy", "battery", "grid", "solar", "charging", "ev"],
  Consumer: ["consumer", "game", "shopping", "brand", "commerce"],
  Defense: ["defense", "satellite", "security", "aerospace", "surveillance"],
  Robotics: ["robot", "robotics", "drone", "autonomous", "logistics automation"],
};

function moneyToUsd(num: string, unit: string): number | null {
  const n = Number(num.replace(/[$,\s]/g, ""));
  if (Number.isNaN(n)) return null;
  const u = unit.toLowerCase();
  if (u === "b" || u.startsWith("bill")) return Math.round(n * 1e9);
  if (u === "m" || u === "mm" || u.startsWith("mill")) return Math.round(n * 1e6);
  if (u === "k" || u.startsWith("thou")) return Math.round(n * 1e3);
  return Math.round(n);
}

const RAISE_RE =
  /rais(?:e|ing|ed)[^\d$]{0,30}(\$?[\d.,]+)\s*(b|mm?|million|k|thousand)?\b/i;
const ARR_RE = /\b(arr|arr of|mrr|revenue)[^\d$]{0,20}(\$?[\d.,]+)\s*([mb]ill(?:ion)?|m|k)?\b/i;
const GROWTH_RE = /(\d{2,3})\s*%\s*(?:yoy|year[- ]over[- ]year|growth|growing)/i;
const TEAM_RE = /team of (\d{1,4})|(?:^|\s)(\d{1,4})[+-]?\s+(?:people|employees|fte)/i;
const FOUNDED_RE = /founded (?:in )?(20\d{2}|19\d{2})/i;
const LOCATION_RE = /based in ([A-Z][\w .'-]+(?:, ?[A-Z]{2})?|[A-Z][\w .'-]+ City)|headquartered in ([A-Z][\w .'-]+)/;
const DOMAIN_FROM_EMAIL_RE = /@([a-z0-9-]+\.[a-z0-9.-]+)$/i;

function firstMatch(text: string, re: RegExp): RegExpMatchArray | null {
  return text.match(re);
}

function containsWord(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/** Fill `select`/`multi_select` fields by matching option labels in text. */
function matchSelectFields(text: string, specs: FieldSpec[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const spec of specs) {
    if (!spec.options?.length) continue;
    if (spec.type === "select") {
      const hit = spec.options.find((o) => containsWord(text, o));
      if (hit) out[spec.key] = hit;
    } else if (spec.type === "multi_select") {
      const hits = spec.options.filter((o) => containsWord(text, o));
      if (hits.length) out[spec.key] = hits;
    }
  }
  return out;
}

function inferSector(text: string): string | null {
  let best: { sector: string; score: number } | null = null;
  for (const [sector, kws] of Object.entries(SECTOR_KEYWORDS)) {
    const score = kws.reduce((acc, kw) => acc + (containsWord(text, kw) ? 1 : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { sector, score };
  }
  return best?.sector ?? null;
}

/** "Intro to Acme", "introducing Foo", "Acme - Series A" style company mentions. */
const INTRO_LINE_RE =
  /(?:intro(?:duce|duction)?\s*(?:to)?|pitch\s+for|meet with|check out)\s+([A-Z][A-Za-z0-9&.]*(?:\s+[A-Z][A-Za-z0-9&.]*){0,3})/g;

export class MockProvider implements AiProvider {
  readonly name = "mock";
  readonly model = "mock-heuristics-v1";

  async extractDeck(text: string, fieldSpecs: FieldSpec[]): Promise<DeckExtraction> {
    const fields: DeckExtraction["fields"] = {};
    let signals = 0;

    const raise = firstMatch(text, RAISE_RE);
    const askUsd = raise ? moneyToUsd(raise[1]!, raise[2] ?? "") : null;

    const arr = text.match(ARR_RE);
    if (arr && fieldSpecs.some((f) => ["arr", "revenue"].includes(f.key))) {
      fields["arr"] = moneyToUsd(arr[2]!, arr[3] ?? "") ?? null;
      signals++;
    }
    const growth = text.match(GROWTH_RE);
    if (growth && fieldSpecs.some((f) => f.key.includes("growth"))) {
      fields["growth_pct"] = Number(growth[1]);
      signals++;
    }

    for (const [key, value] of Object.entries(matchSelectFields(text, fieldSpecs))) {
      fields[key] = value as never;
      signals++;
    }

    // Sector-style selects: fall back to keyword inference when no option
    // label appeared verbatim in the text.
    const sectorField = fieldSpecs.find(
      (f) =>
        f.type === "select" &&
        ["sector", "industry", "category"].includes(f.key) &&
        fields[f.key] === undefined,
    );
    if (sectorField?.options?.length) {
      const inferred = inferSector(text);
      if (inferred && sectorField.options.some((o) => o.toLowerCase() === inferred.toLowerCase())) {
        fields[sectorField.key] = inferred;
        signals++;
      }
    }

    // generic typed fallbacks
    const team = text.match(TEAM_RE);
    const founded = text.match(FOUNDED_RE);
    const loc = text.match(LOCATION_RE);
    const sector = inferSector(text);

    const company: DeckExtraction["company"] = {};
    if (loc) company.location = (loc[1] ?? loc[2])!.trim();
    if (founded) company.foundedYear = Number(founded[1]);
    if (team) company.employeeCount = Number(team[1] ?? team[2]);
    if (sector) company.sector = sector;

    const deal: DeckExtraction["deal"] = {};
    if (askUsd) deal.askAmountUsd = askUsd;
    const roundMatch = text.match(/\b(pre-seed|seed|series [a-e])\b/i);
    if (roundMatch) {
      const raw = roundMatch[1]!;
      deal.roundStage = raw.charAt(0).toUpperCase() + raw.slice(1).replace("Series a", "Series A");
    }
    deal.summary = text.slice(0, 300);

    const confidence = Math.min(0.92, 0.45 + signals * 0.08 + (askUsd ? 0.1 : 0));
    return { company, deal, fields, confidence: Number(confidence.toFixed(2)) };
  }

  async triageEmail(input: {
    subject: string;
    fromEmail: string;
    bodyText: string;
    knownCompanyNames: string[];
  }): Promise<EmailTriage> {
    const text = `${input.subject}\n${input.bodyText}`;
    const companies: EmailTriage["companies"] = [];
    const seen = new Set<string>();

    // Known company names mentioned → link to them.
    for (const name of input.knownCompanyNames) {
      if (name.length > 2 && new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(text)) {
        companies.push({ name, domain: null, confidence: 0.95 });
        seen.add(name.toLowerCase());
        if (companies.length >= 200) break;
      }
    }

    // Intro-style lines surface unknown companies (bulk forwards, deal dumps).
    if (companies.length < 200) {
      for (const match of text.matchAll(INTRO_LINE_RE)) {
        const name = match[1]!.trim().replace(/[.,;:]$/, "");
        const key = name.toLowerCase();
        if (
          name.length > 2 &&
          name.length < 60 &&
          !seen.has(key) &&
          !STOPWORDS.has(key)
        ) {
          companies.push({ name, domain: null, confidence: 0.7 });
          seen.add(key);
          if (companies.length >= 200) break;
        }
      }
    }

    // Unknown sender domain → probable new company.
    const domainMatch = input.fromEmail.match(DOMAIN_FROM_EMAIL_RE);
    const domain = domainMatch?.[1]?.toLowerCase();
    const freeMail =
      domain &&
      ["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "proton.me"].includes(domain);
    if (domain && !freeMail && !companies.length) {
      const guess = domain
        .split(".")[0]!
        .split(/[-_]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
      companies.push({ name: guess, domain, confidence: 0.75 });
      seen.add(guess.toLowerCase());
    }

    const isFundraise = RAISE_RE.test(text) || /\bpitch deck\b|\braising\b|\bfundraising\b/i.test(text);
    const isPortfolioUpdate =
      /\b(update|metrics|milestone|hired|arr|mrr)\b/i.test(input.subject) ||
      /^(update|q[1-4])/i.test(input.subject.trim());

    const intent: EmailTriage["intent"] = isFundraise
      ? "fundraise"
      : isPortfolioUpdate
        ? "portfolio_update"
        : companies.length
          ? "warm_intro"
          : "other";

    const summary =
      text
        .replace(/\s+/g, " ")
        .slice(0, 240)
        .trim() || "(empty body)";

    return {
      intent,
      companies,
      isPortfolioUpdate,
      updateTitle: input.subject.slice(0, 160),
      summary,
      confidence: companies.length ? 0.85 : 0.5,
    };
  }

  async generateThesis(input: ThesisInput): Promise<ThesisMemoOutput> {
    const ask =
      input.askAmount != null
        ? `$${input.askAmount >= 1e6 ? `${(input.askAmount / 1e6).toFixed(1)}M` : input.askAmount}`
        : "an undisclosed amount";
    const lines = [
      `# ${input.companyName} — Investment Memo`,
      "",
      `**Round:** ${input.roundStage ?? "n/a"} · **Ask:** ${ask}${input.sector ? ` · **Sector:** ${input.sector}` : ""}${input.location ? ` · **Location:** ${input.location}` : ""}`,
      "",
      "## What they do",
      input.description?.trim() || firstSentences(input.sourceText, 2) || "(no description captured)",
      "",
      "## Why it fits",
      ...thesisBullets(input),
      "",
      "## Key risks",
      "- Limited independent validation of traction metrics at this stage.",
      `- ${input.sector ? `${input.sector} competitive intensity;` : "Competitive landscape unclear;"} confirm differentiation in diligence.`,
      "",
      "## Suggested next steps",
      "1. Founder call focused on retention and pipeline.",
      "2. Reference checks with 2 current customers.",
      "3. Market map of adjacent competitors before partner meeting.",
      "",
      "_Generated by VentureLabs AI (mock heuristics). Verify all figures independently._",
    ];
    return { memo: lines.join("\n"), confidence: 0.72 };
  }

  async classifyUpdate(text: string): Promise<UpdateClassification> {
    const lower = text.toLowerCase();
    let kind: UpdateClassification["kind"] = "update";
    if (/\bhired?\b|\bjoins?\b|new cto|new ceo|vp of/.test(lower)) kind = "hiring";
    else if (/\braise[d]?\b|\bfunding\b|\bround\b/.test(lower)) kind = "funding";
    else if (/\barr\b|\bmrr\b|\brevenue\b|\bnrr\b|\bcustomers?\b/.test(lower)) kind = "metric";
    else if (/\blaunched?\b|\bmilestone\b|\breached?\b|\bacquired?\b/.test(lower)) kind = "milestone";
    else if (/\bpress\b|\bfeatured\b|\baward\b|\bannounc/.test(lower)) kind = "news";
    return { kind, title: text.replace(/\s+/g, " ").slice(0, 140).trim() };
  }

  /**
   * Deterministic extractive Q&A: score passages by keyword overlap with the
   * question, then lift the most on-point sentences as a cited answer.
   */
  async answerGrounded(input: {
    question: string;
    passages: GroundingPassage[];
  }): Promise<GroundedAnswer> {
    const terms = tokenize(input.question);
    const scored = input.passages
      .map((p, index) => ({ p, index, score: overlapScore(terms, p.text) }))
      .sort((a, b) => b.score - a.score);

    const relevant = scored.filter((s) => s.score > 0).slice(0, 5);
    if (!relevant.length) {
      return {
        answer:
          "No passage in the workspace corpus addresses this question. Widen the scope, " +
          "attach more documents to the vault, or rephrase using terms that appear in your materials.",
        citations: [],
        confidence: 0.2,
      };
    }

    const sentences: Array<{ text: string; citation: number; score: number }> = [];
    for (const { p, index, score } of relevant.slice(0, 4)) {
      for (const sentence of splitSentences(p.text)) {
        const s = overlapScore(terms, sentence);
        if (s > 0) sentences.push({ text: sentence.trim(), citation: index, score: s + score });
      }
    }
    sentences.sort((a, b) => b.score - a.score);

    const picked = dedupeSimilar(sentences.map((s) => s.text)).slice(0, 6);
    const usedCitations = [
      ...new Set(
        sentences
          .filter((s) => picked.includes(s.text))
          .map((s) => s.citation),
      ),
    ];

    const named = usedCitations
      .map((i) => `[${i + 1}] ${input.passages[i]!.sourceName}`)
      .join(", ");
    const answer = `${picked.join(" ")}\n\nSources: ${named}`;

    const confidence = Math.min(0.85, 0.35 + usedCitations.length * 0.1 + Math.min(relevant[0]!.score / 20, 0.2));
    return { answer, citations: usedCitations, confidence: Number(confidence.toFixed(2)) };
  }

  /** Heuristic per-column extraction: money/date/number regexes + keyword matching. */
  async extractTableRows(input: {
    instruction?: string | null;
    columns: ReviewColumnSpec[];
    documents: ReviewDocumentInput[];
  }): Promise<ReviewExtractionOutput> {
    const rows: ReviewExtractionOutput["rows"] = [];

    for (const doc of input.documents) {
      const data: Record<string, string | number | boolean | null> = {};
      const citations: string[] = [];

      for (const col of input.columns) {
        const found = extractColumn(doc.text, col);
        if (found.value !== null) {
          data[col.key] = found.value;
          if (found.quote) citations.push(found.quote);
        } else {
          data[col.key] = null;
        }
      }

      const filled = Object.values(data).filter((v) => v !== null).length;
      rows.push({
        documentId: doc.id,
        data,
        citations: [...new Set(citations)].slice(0, 3),
        confidence: Number(Math.min(0.9, 0.3 + filled * 0.12).toFixed(2)),
      });
    }

    return { rows };
  }

  /** Keyword-driven thesis fit scoring with deterministic reasons/concerns. */
  async scoreThesis(input: ThesisScoreInput): Promise<ThesisScoreOutput> {
    const text = input.sourceText.toLowerCase();
    const reasons: string[] = [];
    const concerns: string[] = [];
    let score = 45;

    let mustHits = 0;
    const mustHave = input.mustHaveKeywords ?? [];
    for (const kw of mustHave) {
      if (containsWord(text, kw.toLowerCase())) {
        mustHits++;
        reasons.push(`Matches required theme "${kw}".`);
      }
    }
    if (mustHave.length) score += Math.round((mustHits / mustHave.length) * 40);
    else score += 10;

    for (const kw of input.excludeKeywords ?? []) {
      if (containsWord(text, kw.toLowerCase())) {
        concerns.push(`Contains excluded theme "${kw}".`);
        score -= 30;
      }
    }

    if (/\bgrow(th|ing)\b|\byoy\b/.test(text)) {
      reasons.push("Growth trajectory referenced in materials.");
      score += 8;
    }
    if (/\b(arr|mrr|revenue)\b/.test(text)) {
      reasons.push("Revenue metrics available for verification.");
      score += 6;
    }
    if (/\b(churn|attrition)\b/.test(text)) {
      concerns.push("Churn mentioned — probe retention drivers.");
      score -= 4;
    }
    const trimmedLen = input.sourceText.trim().length;
    const isThin = trimmedLen < 180 && reasons.length === 0;
    if (isThin) {
      concerns.push("Very little material available to evaluate — needs enrichment before a pass/advance call.");
    }
    if (!input.sector && !text.trim()) {
      concerns.push("Very little material available to evaluate.");
      score -= 10;
    }
    if (input.instructions) {
      const instructionTerms = tokenize(input.instructions).slice(0, 12);
      const hits = instructionTerms.filter((t) => t.length > 3 && containsWord(text, t));
      if (hits.length >= 2) {
        reasons.push(`Aligns with agent instructions (signals: ${hits.slice(0, 4).join(", ")}).`);
        score += 6;
      }
    }

    score = Math.max(1, Math.min(99, score));
    // Never auto-pass on thin context — default to watch so enrichment / docs can upgrade
    if (isThin && score < 40) score = 45;
    if (isThin && reasons.length === 0 && concerns.some((c) => /little material/i.test(c))) {
      // ensure at least watch when we have no signals to judge
      score = Math.max(score, 45);
    }
    const recommendation: ThesisScoreOutput["recommendation"] =
      score >= 65 ? "advance" : score >= 40 ? "watch" : "pass";

    const summary =
      `Fit ${score}/100 against "${input.agentName}" — ${recommendation}. ` +
      (reasons.length ? `Strengths: ${reasons.length} signal(s). ` : "") +
      (concerns.length ? `Flags: ${concerns.length}.` : "");

    const confidence = Number(Math.min(0.88, 0.4 + mustHits * 0.08 + (input.sourceText.length > 500 ? 0.15 : 0)).toFixed(2));
    return {
      fitScore: score,
      recommendation,
      reasons: reasons.slice(0, 6),
      concerns: concerns.slice(0, 6),
      summary,
      confidence,
    };
  }

  /**
   * Deterministic assistant router: maps the user's message onto product
   * tools; when tool results come back (role=tool messages), synthesizes a
   * compact reply from them.
   */
  async assistantTurn(input: AssistantTurnInput): Promise<AssistantTurnResult> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const lastMsg = input.messages[input.messages.length - 1]!;
    const available = new Set(input.tools.map((t) => t.name));

    // ── synthesis turn: results are in, write the answer ─────────────
    if (lastMsg.role === "tool") {
      return { reply: synthesizeFromResults(input.messages), toolCalls: [], confidence: 0.75 };
    }

    const q = (lastUser?.content ?? "").toLowerCase();
    const wants = (...keys: string[]) => keys.some((k) => q.includes(k));
    const has = (n: string) => available.has(n);
    const userText = lastUser?.content ?? "";
    const createNames = extractCreateCompanyNames(userText);
    const createIntent =
      createNames.length > 0 &&
      (wants("add", "create", "new", "put", "open") || wants("pipeline", "board", "crm"));

    if (createIntent && has("create_company")) {
      return {
        reply: null,
        toolCalls: createNames.slice(0, 4).map((name) => ({ name: "create_company", args: { name } })),
        confidence: 0.9,
      };
    }
    if (createIntent && has("create_deal")) {
      return {
        reply: null,
        toolCalls: createNames
          .slice(0, 4)
          .map((companyName) => ({ name: "create_deal", args: { companyName } })),
        confidence: 0.9,
      };
    }

    // verbatim tool mention → call it directly ("get_workspace_info", "list_vaults…")
    if (userText) {
      const mentioned = input.tools.find(
        (t) =>
          t.name.length > 6 &&
          new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(userText),
      );
      if (mentioned) {
        const args = fillMissingToolArgs(mentioned, {}, userText);
        if (!missingRequiredArgs(mentioned.inputSchema, args).length) {
          return { reply: null, toolCalls: [{ name: mentioned.name, args }], confidence: 0.9 };
        }
      }
    }

    // company-specific question → look it up first
    const namedCompany = matchCompanyMention(userText) ?? createNames[0] ?? null;

    if (wants("pipeline", "deals", "stage", "funnel") && !wants("risk", "attention", "stale")) {
      const calls = [] as AssistantTurnResult["toolCalls"];
      if (has("analytics_overview")) calls.push({ name: "analytics_overview", args: {} });
      if (has("list_deals")) calls.push({ name: "list_deals", args: { limit: 5 } });
      if (calls.length) return { reply: null, toolCalls: calls.slice(0, 2), confidence: 0.8 };
    }

    if (wants("risk", "attention", "stale", "quiet", "watch")) {
      const calls = [] as AssistantTurnResult["toolCalls"];
      if (has("list_portfolio_updates")) calls.push({ name: "list_portfolio_updates", args: { limit: 5 } });
      if (has("list_deals")) calls.push({ name: "list_deals", args: { sort: "updated_at", order: "asc", limit: 5 } });
      if (calls.length) return { reply: null, toolCalls: calls.slice(0, 2), confidence: 0.8 };
    }

    if ((wants("portfolio", "updates", "highlights")) && has("list_portfolio_updates")) {
      return { reply: null, toolCalls: [{ name: "list_portfolio_updates", args: { limit: 8 } }], confidence: 0.8 };
    }

    if (namedCompany && has("search_companies")) {
      return {
        reply: null,
        toolCalls: [{ name: "search_companies", args: { q: namedCompany } }],
        confidence: 0.85,
      };
    }

    // general question → grounded research
    if (q.endsWith("?") || wants("what", "how", "which", "why", "summar", "according")) {
      if (has("ask_knowledge")) {
        return {
          reply: null,
          toolCalls: [{ name: "ask_knowledge", args: { question: lastUser?.content?.slice(0, 500) ?? q } }],
          confidence: 0.8,
        };
      }
    }

    if (wants("adoption", "usage", "benchmark", "command center") && has("command_center_overview")) {
      return { reply: null, toolCalls: [{ name: "command_center_overview", args: {} }], confidence: 0.8 };
    }

    if (wants("vault", "data room", "review table") && has("list_vaults")) {
      return { reply: null, toolCalls: [{ name: "list_vaults", args: {} }], confidence: 0.8 };
    }

    if (wants("agent") && has("list_agents")) {
      return { reply: null, toolCalls: [{ name: "list_agents", args: {} }], confidence: 0.8 };
    }

    if (wants("task", "todo", "checklist") && has("list_tasks")) {
      return { reply: null, toolCalls: [{ name: "list_tasks", args: {} }], confidence: 0.8 };
    }

    if (wants("remember that", "note that", "keep in mind") && has("remember")) {
      const content = lastUser?.content ?? "";
      const remembered = content.replace(/^.*?(remember that|note that|keep in mind)[:\s-]*/i, "").trim();
      return { reply: null, toolCalls: [{ name: "remember", args: { content: remembered || content } }], confidence: 0.85 };
    }

    // no tool needed — direct conversational reply
    return {
      reply:
        `I can help with deals, diligence vaults, portfolio updates, research and your fund's command center. ` +
        `Try: “How is the pipeline?”, “Which deals need attention?”, “What do customer contracts say about change of control?”, or “Remember that we only lead North America rounds.”`,
      toolCalls: [],
      confidence: 0.5,
    };
  }
}

function matchCompanyMention(text: string): string | null {
  const m = text.match(/\b(?:about|for|on|of)\s+([A-Z][A-Za-z]{2,}(?:\s?[A-Z][A-Za-z]{2,})?)\b/);
  return m ? m[1]! : null;
}

/** Compose the final chat reply from executed tool results. */
function fmtShortDate(iso: unknown): string {
  const d = new Date(String(iso ?? ""));
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Portfolio updates get a proper card layout instead of field-label soup. */
function formatUpdateBlocks(items: Record<string, unknown>[]): string {
  const blocks = items.slice(0, 6).map((u) => {
    const detail =
      (typeof u.body === "string" && u.body.trim()) ||
      (typeof u.update === "string" && u.update.trim()) ||
      "";
    const meta = [fmtShortDate(u.occurredAt ?? u.date), typeof u.source === "string" ? `via ${u.source.toLowerCase()}` : ""]
      .filter(Boolean)
      .join(" · ");
    const kind = typeof u.kind === "string" && u.kind !== "update" ? ` *(${u.kind})*` : "";
    return `**${String(u.companyName ?? "")}**${kind} — ${String(u.title ?? "")}\n${[detail, meta].filter(Boolean).join("\n")}`;
  });
  return `Recent portfolio activity:\n\n${blocks.join("\n\n")}`;
}

const looksLikeUpdate = (o: Record<string, unknown>) =>
  typeof o.title === "string" && typeof o.companyName === "string";

function synthesizeFromResults(messages: AssistantTurnInput["messages"]): string {
  const parts: string[] = [];

  for (const block of messages.filter((m) => m.role === "tool").slice(-3)) {
    let parsed: unknown;
    try {
      parsed = parseToolPayload(block.content);
    } catch {
      continue;
    }

    // bare arrays (list results)
    if (Array.isArray(parsed)) {
      const objs = parsed.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
      if (objs.length && objs.every(looksLikeUpdate)) {
        parts.push(formatUpdateBlocks(objs));
      } else {
        for (const item of objs.slice(0, 5)) {
          parts.push(formatRecord(item));
        }
      }
      continue;
    }

    if (!parsed || typeof parsed !== "object") continue;
    const o = parsed as Record<string, unknown>;

    // wrapped list envelope
    if (Array.isArray(o.items)) {
      const objs = (o.items as unknown[]).filter((x) => x && typeof x === "object") as Record<string, unknown>[];
      if (objs.length && objs.every(looksLikeUpdate)) {
        parts.push(formatUpdateBlocks(objs));
      } else {
        for (const item of objs.slice(0, 5)) {
          parts.push(formatRecord(item, true));
        }
      }
      continue;
    }

    // analytics overview
    if ("activeDeals" in o) {
      parts.push(
        `- Pipeline: ${String(o.activeDeals)} active deal(s)` +
          (typeof o.pipelineUsd === "number" ? `, $${Math.round((o.pipelineUsd / 1e6) * 10) / 10}M in play` : ""),
      );
      continue;
    }

    // research report
    if ("answer" in o) {
      const firstLine = String(o.answer).split("\n")[0] ?? "";
      const cites = Array.isArray(o.citations)
        ? (o.citations as Array<{ sourceName?: string }>).map((c) => c.sourceName).filter(Boolean).join(", ")
        : "";
      parts.push(`${firstLine.slice(0, 400)}${cites ? `\n  (sources: ${cites})` : ""}`);
      continue;
    }

    parts.push(formatRecord(o));
  }

  if (!parts.length) return "Done — I could not extract anything more specific from the tools; try rephrasing.";
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join("\n");
}

function parseToolPayload(content: string): unknown {
  const arrow = content.lastIndexOf(" → ");
  const raw = arrow >= 0 ? content.slice(arrow + 3).trim() : content.trim();
  return JSON.parse(raw);
}

function formatRecord(rec: Record<string, unknown>, isEnvelopeItem = false): string {
  if ("error" in rec) return `- ⚠ ${String(rec.error).slice(0, 140)}`;
  if (typeof rec.name === "string" && ("stageId" in rec || "pipelineId" in rec || "status" in rec)) {
    return (
      `- **${rec.name}** is on the pipeline` +
      (rec.roundStage ? ` (${String(rec.roundStage)})` : "") +
      (rec.askAmount != null ? ` — $${Number(rec.askAmount).toLocaleString()}` : "")
    );
  }
  // portfolio updates (have title + kind + companyName) — check before deals
  if ("title" in rec && "kind" in rec) {
    return `- Portfolio ${String(rec.kind)}: ${String(rec.companyName ?? "")} — ${String(rec.title)}`;
  }
  // deals — direct ({ companyName }) or full MCP shape ({ company: { name } })
  const company =
    typeof rec.companyName === "string"
      ? String(rec.companyName)
      : rec.company && typeof rec.company === "object" && "name" in (rec.company as Record<string, unknown>)
        ? String((rec.company as Record<string, unknown>).name)
        : null;
  if (company) {
    return (
      `- Deal: **${company}**` +
      (rec.roundStage ? ` (${String(rec.roundStage)})` : "") +
      (rec.askAmount != null ? ` — $${Number(rec.askAmount).toLocaleString()}` : "") +
      (rec.updatedAt ? ` · updated ${String(rec.updatedAt).slice(0, 10)}` : "")
    );
  }
  // agents
  if ("agentId" in rec || ("name" in rec && "kind" in rec)) {
    return `- Agent: ${String(rec.name)}${rec.isActive === false ? " (inactive)" : ""} · ${String(rec.runCount ?? 0)} run(s)`;
  }
  // vaults
  if ("documents" in rec && "parsed" in rec) {
    return `- Vault ${String(rec.name)}: ${String(rec.parsed)}/${String(rec.documents)} docs parsed · ${String(rec.reviewTables)} table(s)`;
  }
  // tasks
  if ("taskId" in rec && "title" in rec) {
    return `- Task: ${String(rec.title)} [${String(rec.status)}]`;
  }
  // command center
  if ("aiLeveragePct" in rec) {
    return `- AI leverage: ${String(rec.aiLeveragePct)}% of tracked activity`;
  }
  // memories
  if ("memoryId" in rec) {
    return `- Remembered: ${String(rec.remembered ?? "").slice(0, 120)}`;
  }
  const entries = Object.entries(rec).slice(0, isEnvelopeItem ? 3 : 5);
  return "- " + entries.map(([k, v]) => `${k}: ${typeof v === "object" ? "…" : String(v).slice(0, 60)}`).join(" · ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STOPWORDS = new Set([
  "the", "and", "our", "you", "your", "this", "that", "team", "company",
  "attached", "please", "find", "would", "love", "meet", "check", "pitch",
  "deck", "update", "introduction", "intro",
]);


function firstSentences(text: string, n: number): string {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s/)
    .slice(0, n)
    .join(" ")
    .slice(0, 400);
}

function thesisBullets(input: ThesisInput): string[] {
  const bullets: string[] = [];
  if (/grow|growing|growth|yoy/i.test(input.sourceText))
    bullets.push("- Strong reported growth trajectory cited in materials.");
  if (/arr|mrr|revenue/i.test(input.sourceText))
    bullets.push("- Revenue-bearing product with recurring metrics available for verification.");
  if (input.location) bullets.push(`- Positioned in ${input.location}, within our preferred coverage.`);
  if (input.roundStage === "Seed" || input.roundStage === "Pre-seed")
    bullets.push("- Early entry point consistent with fund ownership targets.");
  if (!bullets.length) bullets.push("- Early-stage opportunity; thesis to be validated in first meeting.");
  return bullets;
}

/* ── grounded research / review-table helpers ──────────────────────── */

const STOP_TERMS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "of", "to", "in", "on", "for",
  "and", "or", "what", "which", "who", "whom", "how", "why", "when", "where",
  "does", "do", "did", "with", "about", "their", "our", "your", "from", "by",
  "at", "as", "be", "been", "it", "its", "this", "that", "these", "those",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s$%.-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t.length > 1 && !STOP_TERMS.has(t));
}

function overlapScore(terms: string[], text: string): number {
  if (!terms.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (lower.includes(term)) score += term.length > 4 ? 2 : 1;
  }
  return score;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .filter((s) => s.trim().length > 30 && s.trim().length < 600);
}

function dedupeSimilar(sentences: string[]): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (!out.some((o) => jaccard(o, s) > 0.5)) out.push(s);
  }
  return out;
}

function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Per-column deterministic extraction used by the mock provider. */
function extractColumn(
  text: string,
  col: ReviewColumnSpec,
): { value: string | number | boolean | null; quote?: string } {
  const semantic = extractSemanticColumn(text, col);
  if (semantic) return semantic;

  const labelRe = new RegExp(
    `${escapeRe(col.label)}\\s*[:\\-–]?\\s*([^\\n.]{1,120})`,
    "i",
  );

  if (col.type === "currency") {
    const labelled = text.match(
      new RegExp(`${escapeRe(col.label)}[^\\d$]{0,40}(\\$?\\s?[\\d.,]+)\\s*(billion|million|bill|mill|\\bb\\b|\\bm\\b|mm|k)?`, "i"),
    );
    if (labelled?.[1]) {
      const n = Number(labelled[1].replace(/[$,\s]/g, ""));
      if (!Number.isNaN(n)) {
        const unit = (labelled[2] ?? "").toLowerCase();
        const mult = unit.startsWith("b") ? 1e9 : unit.startsWith("m") ? 1e6 : unit === "k" ? 1e3 : inferCurrencyUnit(n);
        return { value: Math.round(n * mult), quote: firstSentenceAround(text, labelled[0]) };
      }
    }
    // any money figure near a dollar sign as fallback
    const anyMoney = text.match(/\$\s?([\d.,]+)\s*(billion|million|\bb\b|\bm\b|mm|k)?/i);
    if (anyMoney) {
      const n = Number(anyMoney[1]!.replace(/,/g, ""));
      if (!Number.isNaN(n)) {
        const unit = (anyMoney[2] ?? "").toLowerCase();
        const mult = unit.startsWith("b") ? 1e9 : unit.startsWith("m") || unit === "mm" ? 1e6 : unit === "k" ? 1e3 : inferCurrencyUnit(n);
        return { value: Math.round(n * mult), quote: firstSentenceAround(text, anyMoney[0]) };
      }
    }
    // "Annual contract value: $240,000" style without $ sign handled above;
    // bare "<label>: <money words>" last resort
    const m = text.match(labelRe);
    if (m?.[1]) {
      const numMatch = m[1].match(/([\d.,]+)/);
      if (numMatch) {
        const n = Number(numMatch[1].replace(/,/g, ""));
        if (!Number.isNaN(n)) return { value: Math.round(n * inferCurrencyUnit(n)), quote: firstSentenceAround(text, m[0]) };
      }
    }
    return { value: null };
  }

  if (col.type === "number") {
    const m = text.match(new RegExp(`${escapeRe(col.label)}[^\\d]{0,40}([\\d.,]+)\\s*(%?)`, "i"));
    if (m) {
      const n = Number(m[1]!.replace(/,/g, ""));
      if (!Number.isNaN(n)) {
        return { value: n, quote: firstSentenceAround(text, m[0]) };
      }
    }
    // generic "<digits> <unit>" near a keyword of the label
    const kw = col.label.split(/\s+/)[0];
    if (kw && kw.length > 3) {
      const m2 = text.match(new RegExp(`([\\d.,]+)\\\\?\\s*(?:days?|months?|years?|%)[^.\\n]{0,40}${escapeRe(kw)}`, "i"))
        ?? text.match(new RegExp(`${escapeRe(kw)}[^\\n.]{0,40}?([\\d.,]+)\\s*(?:days?|months?|years?|%)`, "i"));
      if (m2) {
        const n = Number(m2[1]!.replace(/,/g, ""));
        if (!Number.isNaN(n)) return { value: n, quote: firstSentenceAround(text, m2[0]) };
      }
    }
    return { value: null };
  }

  if (col.type === "date") {
    const m =
      text.match(new RegExp(`${escapeRe(col.label)}[^\\n.]{0,40}`, "i")) ??
      text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2},? \d{4}\b/i);
    if (m) return { value: m[0].replace(new RegExp(`^${escapeRe(col.label)}`, "i"), "").trim().slice(0, 40), quote: firstSentenceAround(text, m[0]) };
    return { value: null };
  }

  if (col.type === "boolean") {
    const hit = booleanSignal(text, col);
    if (hit !== null) return { value: hit, quote: firstSentenceAround(text, hit ? col.label : col.key.replace(/_/g, " ")) };
    return { value: null };
  }

  // text
  const m = text.match(labelRe);
  if (m?.[1]) return { value: m[1].trim().slice(0, 200), quote: firstSentenceAround(text, m[0]) };
  return { value: null };
}

/**
 * Semantic patterns for the standard diligence column vocabulary
 * (counterparty, change-of-control, renewal, termination, term…). Keeps the
 * offline provider genuinely useful on real data-room documents.
 */
function extractSemanticColumn(
  text: string,
  col: ReviewColumnSpec,
): { value: string | number | boolean | null; quote?: string } | null {
  const key = col.key.toLowerCase();
  const label = col.label.toLowerCase();

  // counterparty / party names — "between X and Y" → Y is the counterparty
  if (/counterparty|^part(y|ies)$/.test(key) || /counterparty/.test(label)) {
    const both = text.match(/\bbetween\s+([A-Z][A-Za-z0-9&.'\- ]{2,50}?)\s+and\s+([A-Z][A-Za-z0-9&.'\- ]{2,50}?)(?:\s*[.,]|\s+for\b|\s+with\b)/);
    if (both) {
      // the document subject is usually named first; counterparty is the other side
      const second = both[2].trim().replace(/\s+/g, " ");
      return { value: second.slice(0, 80), quote: firstSentenceAround(text, both[0]) };
    }
    const m =
      text.match(/\b(?:with|by and between)\s+([A-Z][A-Za-z0-9&.'\- ]{2,50}?)(?:\s+and\b|[.,])/) ??
      text.match(/^([A-Z][A-Za-z0-9&.'\- ]{2,50}?)\s+(?:agreement|msa|pilot|sow|order form)/m);
    if (m) {
      const name = m[1].trim().replace(/\s+/g, " ");
      return { value: name.slice(0, 80), quote: firstSentenceAround(text, m[0]) };
    }
    return null;
  }

  // change of control
  if (key.includes("change_of_control") || key.includes("coc") || label.includes("change")) {
    const m = text.match(/change[ -]?of[ -]?control[^.]{0,120}/i);
    if (!m) return { value: false };
    const requiresConsent = /consent|approval|written notice required/i.test(m[0]);
    return { value: requiresConsent, quote: firstSentenceAround(text, m[0]) };
  }

  // automatic renewal
  if (key.includes("renewal") || key.includes("renew") || label.includes("renewal")) {
    const m = text.match(/(automatic[al]*|auto[- ]?renew[a-z]*|shall (?:be )?automatically renew|evergreen)[^.]{0,100}/i)
      ?? text.match(/[a-z]+ renewal[^.]{0,100}/i);
    if (!m) {
      const evergreen = /successive (?:one|1)[- ]year periods|continues until terminated/i.test(text);
      return evergreen ? { value: true, quote: firstSentenceAround(text, "successive") } : { value: false };
    }
    return { value: true, quote: firstSentenceAround(text, m[0]) };
  }

  // termination notice period
  if (key.includes("notice") || key.includes("termination") || label.includes("notice")) {
    const m =
      text.match(/(?:on|with|upon)\s+(\d+)\s*days?["']?\s*(?:written\s*)?notice/i) ??
      text.match(/(\d+)\s*days?["']?\s*(?:prior\s*)?(?:written\s*)?notice/i) ??
      text.match(/notice[^.\n]{0,40}?(\d+)\s*days?/i);
    if (m) return { value: Number(m[1]), quote: firstSentenceAround(text, m[0]) };
    return null;
  }

  // contract term length
  if (key.endsWith("_months") || key === "term" || key.includes("term_length") || label === "term") {
    const m =
      text.match(/term of\s+(\d+)\s*(months?|years?)/i) ??
      text.match(/(?:initial term|term)\s*(?:of|:)?\s*(\d+)\s*(months?|years?)/i) ??
      text.match(/(\d+)[ -]month(?:s)?\s+(?:term|engagement)/i);
    if (m) {
      const months = /month/i.test(m[2] ?? "months") ? Number(m[1]) : Number(m[1]) * 12;
      return { value: `${months} months`, quote: firstSentenceAround(text, m[0]) };
    }
    return null;
  }

  // IP assignment
  if (key.includes("ip_") || key.includes("intellectual") || label.includes("ip assignment")) {
    const m = text.match(/(?:ip|intellectual property)[^.]{0,160}/i);
    if (m) return { value: m[0].slice(0, 180).trim(), quote: firstSentenceAround(text, m[0]) };
    return null;
  }

  return null;
}

/** Boolean columns: look for affirmative/negative signal phrases for the concept. */
function booleanSignal(text: string, col: ReviewColumnSpec): boolean | null {
  const key = col.key.toLowerCase().replace(/_/g, " ");
  const labelLc = col.label.toLowerCase();
  const concepts = [...new Set([key, labelLc].flatMap((c) => c.split(/[,/]|\band\b/).map((x) => x.trim())))]
    .filter((c) => c.length > 3);

  for (const concept of concepts) {
    const re = new RegExp(concept.replace(/\s+/g, "[ -]?"), "i");
    if (re.test(text)) return true;
  }
  // explicit negation anywhere near the strongest concept
  const anyConcept = concepts.map((c) => c.replace(/\s+/g, "[ -]?")).join("|");
  if (anyConcept && new RegExp(`no ${anyConcept}|shall not contain`, "i").test(text)) return false;
  return null;
}

function inferCurrencyUnit(n: number): number {
  // "$1.4" next to no unit in a deck usually means millions
  if (n > 0 && n < 1000) return 1e6;
  return 1;
}

function firstSentenceAround(text: string, needle: string): string | undefined {
  const idx = text.toLowerCase().indexOf(needle.toLowerCase());
  if (idx < 0) return undefined;
  const start = Math.max(0, text.lastIndexOf(".", idx) + 1);
  const end = text.indexOf(".", idx + needle.length);
  const slice = text.slice(start, end > 0 ? end + 1 : Math.min(text.length, idx + 240)).trim();
  return slice.slice(0, 300) || undefined;
}
