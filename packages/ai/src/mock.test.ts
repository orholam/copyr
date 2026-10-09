import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock.js";
import type { FieldSpec } from "./types.js";

const specs: FieldSpec[] = [
  { key: "sector", label: "Sector", type: "select", options: ["AI/ML", "Fintech", "Health"] },
  { key: "arr", label: "ARR", type: "currency" },
  { key: "growth_pct", label: "YoY Growth %", type: "number" },
];

describe("MockProvider.extractDeck", () => {
  const ai = new MockProvider();

  it("extracts raise, sector, arr and growth from deck text", async () => {
    const text = `QuantumLeap AI\nWe are raising $15M Series A.\nARR of $4.2M growing 180% YoY.\nTeam of 24 based in San Francisco. Founded in 2023.`;
    const out = await ai.extractDeck(text, specs);
    expect(out.deal.askAmountUsd).toBe(15_000_000);
    expect(out.deal.roundStage).toBe("Series A");
    expect(out.company.employeeCount).toBe(24);
    expect(out.company.foundedYear).toBe(2023);
    expect(out.fields["sector"]).toBe("AI/ML");
    expect(out.fields["arr"]).toBe(4_200_000);
    expect(out.fields["growth_pct"]).toBe(180);
    expect(out.confidence).toBeGreaterThan(0.6);
  });

  it("returns empty extraction for garbage input without throwing", async () => {
    const out = await ai.extractDeck("lorem ipsum dolor sit amet", specs);
    expect(out.deal.askAmountUsd).toBeUndefined();
    expect(out.confidence).toBeLessThan(0.7);
  });

  it("parses thousands correctly", async () => {
    const out = await ai.extractDeck("Raising $750K pre-seed round", specs);
    expect(out.deal.askAmountUsd).toBe(750_000);
    expect(out.deal.roundStage).toBe("Pre-seed");
  });
});

describe("MockProvider.triageEmail", () => {
  const ai = new MockProvider();

  it("links known companies mentioned in the body", async () => {
    const out = await ai.triageEmail({
      subject: "Intro to QuantumLeap AI",
      fromEmail: "friend@gmail.com",
      bodyText: "You should meet the team at DataFlow Systems.",
      knownCompanyNames: ["DataFlow Systems", "Reactiv"],
    });
    expect(out.companies.map((c) => c.name)).toContain("DataFlow Systems");
  });

  it("guesses company name from sender domain when unknown", async () => {
    const out = await ai.triageEmail({
      subject: "Pitch Deck - Series A",
      fromEmail: "priya@quantumleap.ai",
      bodyText: "Attached is our deck. We are raising $15M.",
      knownCompanyNames: [],
    });
    expect(out.intent).toBe("fundraise");
    expect(out.companies[0]!.name).toBe("Quantumleap");
    expect(out.companies[0]!.domain).toBe("quantumleap.ai");
  });
});

const createCompanyTool = {
  name: "create_company",
  description: "Create a company and put it on the pipeline",
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  },
};

const listDealsTool = {
  name: "list_deals",
  description: "List pipeline cards",
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
};

describe("MockProvider.assistantTurn", () => {
  const ai = new MockProvider();

  it("adds a named company with create_company instead of listing the pipeline", async () => {
    const turn = await ai.assistantTurn({
      messages: [{ role: "user", content: "Add OpenAI to the pipeline" }],
      tools: [createCompanyTool, listDealsTool],
    });
    expect(turn.toolCalls).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
  });

  it("does not call create_company with empty args when the tool is mentioned", async () => {
    const turn = await ai.assistantTurn({
      messages: [{ role: "user", content: "Please run create_company for Anthropic" }],
      tools: [createCompanyTool],
    });
    expect(turn.toolCalls).toEqual([{ name: "create_company", args: { name: "Anthropic" } }]);
  });

  it("synthesizes a reply from prefixed tool transcripts", async () => {
    const turn = await ai.assistantTurn({
      messages: [
        { role: "user", content: "Add OpenAI to the pipeline" },
        {
          role: "tool",
          content: `create_company({"name":"OpenAI"}) → ${JSON.stringify({
            name: "OpenAI",
            stageId: "stage-1",
            pipelineId: "pipe-1",
            status: "active",
          })}`,
        },
      ],
      tools: [createCompanyTool],
    });
    expect(turn.reply).toContain("OpenAI");
    expect(turn.reply).toContain("pipeline");
    expect(turn.toolCalls).toEqual([]);
  });

  it("still lists the pipeline for a status question", async () => {
    const turn = await ai.assistantTurn({
      messages: [{ role: "user", content: "How is the pipeline looking?" }],
      tools: [createCompanyTool, listDealsTool],
    });
    expect(turn.toolCalls.map((c) => c.name)).toEqual(["list_deals"]);
  });
});
const baseThesis = {
  agentName: "Thesis Screener",
  companyName: "Acme",
  sourceText: "",
};

describe("MockProvider.scoreThesis", () => {
  const ai = new MockProvider();

  it("stays on watch for thin material — never advance or pass", async () => {
    const out = await ai.scoreThesis({
      ...baseThesis,
      sourceText: "Acme Inc",
    });
    expect(out.recommendation).toBe("watch");
    expect(out.fitScore).toBeGreaterThanOrEqual(40);
    expect(out.fitScore).toBeLessThan(65);
    expect(out.concerns.some((c) => /little material/i.test(c))).toBe(true);
    expect(out.confidence).toBeLessThanOrEqual(0.5);
  });

  it("advances when must-haves, growth, and revenue signals align", async () => {
    const text = `
      Acme builds B2B infrastructure software for developers.
      ARR of $4.2M growing 120% YoY. Strong retention and expansion.
      Series A raise with clear go-to-market in infrastructure.
    `.repeat(2);
    const out = await ai.scoreThesis({
      ...baseThesis,
      sourceText: text,
      mustHaveKeywords: ["infrastructure", "b2b"],
      instructions: "We back infrastructure software businesses at Series A",
      sector: "Dev Tools",
    });
    expect(out.recommendation).toBe("advance");
    expect(out.fitScore).toBeGreaterThanOrEqual(65);
    expect(out.reasons.length).toBeGreaterThan(0);
    expect(out.confidence).toBeGreaterThan(0.5);
  });

  it("passes when excludes dominate and must-haves are missing", async () => {
    const text = `
      Consumer social gaming marketplace with crypto tokens and speculative trading.
      Heavy consumer brand focus, no enterprise pipeline mentioned anywhere.
      Raising a consumer round for marketplace liquidity and token incentives.
    `.repeat(2);
    const out = await ai.scoreThesis({
      ...baseThesis,
      sourceText: text,
      mustHaveKeywords: ["infrastructure", "b2b"],
      excludeKeywords: ["crypto", "consumer"],
    });
    expect(out.recommendation).toBe("pass");
    expect(out.concerns.some((c) => /excluded/i.test(c))).toBe(true);
    expect(out.concerns.some((c) => /Missing required/i.test(c))).toBe(true);
  });

  it("does not advance when an exclude keyword is present", async () => {
    const text = `
      Acme is a B2B infrastructure platform with ARR of $8M growing 90% YoY.
      Strong enterprise pipeline. Also exploring a crypto side product for payments.
      Deep technical team and clear Series A narrative around infrastructure.
    `.repeat(2);
    const out = await ai.scoreThesis({
      ...baseThesis,
      sourceText: text,
      mustHaveKeywords: ["infrastructure", "b2b"],
      excludeKeywords: ["crypto"],
    });
    expect(out.recommendation).not.toBe("advance");
    expect(out.concerns.some((c) => /excluded theme "crypto"/i.test(c))).toBe(true);
  });
});
