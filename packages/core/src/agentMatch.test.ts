import { describe, expect, it } from "vitest";
import { matchAgent, type AgentCandidate } from "./agentMatch.js";

const agents: AgentCandidate[] = [
  { id: "1", name: "Website Enricher", description: "Researches the company and fills empty facts." },
  { id: "2", name: "Thesis Screener", description: "Scores each inbound company against the firm thesis." },
  { id: "3", name: "Diligence Checklist Builder", description: "Provisions a standard diligence checklist." },
];

describe("matchAgent", () => {
  it("matches an exact name regardless of case", () => {
    expect(matchAgent("thesis screener", agents)?.id).toBe("2");
  });

  it("matches a loose word to the one agent it describes", () => {
    expect(matchAgent("enrichment", agents)?.id).toBe("1");
    expect(matchAgent("enrichment_agent", agents)?.id).toBe("1");
  });

  it("returns null when nothing or too many agents fit", () => {
    expect(matchAgent("portfolio", agents)).toBeNull();
    expect(matchAgent("company", agents)).toBeNull();
  });
});
