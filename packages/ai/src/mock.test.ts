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