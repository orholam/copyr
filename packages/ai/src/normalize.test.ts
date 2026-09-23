import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock.js";
import { withContractEnforcement } from "./normalize.js";
import type { AiProvider, FieldSpec } from "./types.js";

const specs: FieldSpec[] = [
  { key: "sector", label: "Sector", type: "select", options: ["AI/ML", "Fintech", "Health"] },
];

describe("withContractEnforcement", () => {
  it("preserves prototype methods on class providers (assistantTurn)", async () => {
    const wrapped = withContractEnforcement(new MockProvider());

    expect(typeof wrapped.assistantTurn).toBe("function");
    expect(typeof wrapped.answerGrounded).toBe("function");
    expect(typeof wrapped.extractTableRows).toBe("function");
    expect(typeof wrapped.scoreThesis).toBe("function");
    expect(wrapped.name).toBe("mock");
    expect(wrapped.model).toBe("mock-heuristics-v1");

    const turn = await wrapped.assistantTurn({
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });
    expect(turn.reply).toEqual(expect.any(String));
    expect(turn.reply!.length).toBeGreaterThan(0);
    expect(turn.toolCalls).toEqual([]);
  });

  it("still normalizes extractDeck / classifyUpdate / generateThesis / triageEmail", async () => {
    const wrapped = withContractEnforcement(new MockProvider());
    const text =
      "QuantumLeap AI is raising $15M Series A. ARR of $4.2M growing 180% YoY. Based in San Francisco.";

    const deck = await wrapped.extractDeck(text, specs);
    expect(deck.deal.askAmountUsd).toBe(15_000_000);
    expect(deck.confidence).toBeGreaterThan(0);
    expect(deck.confidence).toBeLessThanOrEqual(1);

    const classified = await wrapped.classifyUpdate("Hired a new CTO last week");
    expect(classified.kind).toBe("hiring");

    const thesis = await wrapped.generateThesis({
      companyName: "QuantumLeap",
      sourceText: text,
    });
    expect(thesis.memo).toContain("QuantumLeap");
    expect(thesis.confidence).toBeGreaterThan(0);

    const triage = await wrapped.triageEmail({
      subject: "Intro to Acme",
      fromEmail: "a@b.com",
      bodyText: "Would love to intro Acme raising seed",
      knownCompanyNames: [],
    });
    expect(triage.intent).toBeTruthy();
  });

  it("normalizes scoreThesis when the model omits reasons/concerns arrays", async () => {
    const raw: AiProvider = {
      name: "stub",
      model: "stub",
      async extractDeck() {
        return { company: {}, deal: {}, fields: {}, confidence: 0.5 };
      },
      async triageEmail() {
        return {
          intent: "other",
          companies: [],
          isPortfolioUpdate: false,
          updateTitle: null,
          summary: "x",
          confidence: 0.5,
        };
      },
      async classifyUpdate() {
        return { kind: "update", title: "t" };
      },
      async generateThesis() {
        return { memo: "m", confidence: 0.5 };
      },
      async scoreThesis() {
        return {
          fitScore: 72,
          recommendation: "advance",
          summary: "Looks strong",
        } as never;
      },
      async assistantTurn() {
        return { reply: "ok", toolCalls: [], confidence: 0.5 };
      },
      async answerGrounded() {
        return { answer: "a", citations: [], confidence: 0.5 };
      },
      async extractTableRows() {
        return { rows: [] };
      },
    };
    const wrapped = withContractEnforcement(raw);
    const score = await wrapped.scoreThesis({
      agentName: "Thesis Screener",
      companyName: "Acme",
      sourceText: "Acme is raising",
    });
    expect(score.reasons).toEqual([]);
    expect(score.concerns).toEqual([]);
    expect(score.fitScore).toBe(72);
    expect(score.recommendation).toBe("advance");
    expect(score.summary).toBe("Looks strong");
  });

  it("maps drifted provider output onto the documented contract", async () => {
    const drifted: AiProvider = {
      name: "drift",
      model: "drift-v1",
      async extractDeck() {
        return { company: {}, deal: {}, fields: {}, confidence: 0.9 } as never;
      },
      async triageEmail() {
        return { intent: "funding", companies: [], isPortfolioUpdate: false, summary: "x", confidence: 0.9 } as never;
      },
      async classifyUpdate() {
        return { kind: "unknown", title: "hello" } as never;
      },
      async generateThesis() {
        return { memo: "   ", confidence: 9 } as never;
      },
      async answerGrounded() {
        return { answer: "n/a", citations: [], confidence: 0 };
      },
      async extractTableRows() {
        return { rows: [] };
      },
      async scoreThesis() {
        return {
          fitScore: 0,
          recommendation: "pass",
          reasons: [],
          concerns: [],
          summary: "",
          confidence: 0,
        };
      },
      async assistantTurn() {
        return { reply: "ok", toolCalls: [], confidence: 1 };
      },
    };

    const wrapped = withContractEnforcement(drifted);
    expect(typeof wrapped.assistantTurn).toBe("function");

    const deck = await wrapped.extractDeck("deck", []);
    expect(deck.confidence).toBe(0.9);

    const triage = await wrapped.triageEmail({
      subject: "hi",
      fromEmail: "a@b.com",
      bodyText: "body",
      knownCompanyNames: [],
    });
    expect(triage.intent).toBe("fundraise");

    const classified = await wrapped.classifyUpdate("hello");
    expect(classified.kind).toBe("update");

    const thesis = await wrapped.generateThesis({ companyName: "X", sourceText: "y" });
    expect(thesis.memo).toBe("(no memo generated)");
    expect(thesis.confidence).toBe(1);
  });
});
