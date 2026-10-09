import { describe, expect, it } from "vitest";
import { queuedAgentReply } from "./assistant.js";

describe("queuedAgentReply", () => {
  it("points at the company timeline and does not promise a later chat update", () => {
    const text = queuedAgentReply([
      { agentName: "Website Enricher", companyName: "Liminal Industries" },
      { agentName: "Website Enricher", companyName: "SoFab", alreadyQueued: true },
    ]);
    expect(text).toContain("**Website Enricher** is queued for **Liminal Industries**.");
    expect(text).toContain("**Website Enricher** is already running for **SoFab**.");
    expect(text).toContain("company timeline");
    expect(text.toLowerCase()).not.toMatch(/i'll update|notify you|check back/);
  });
});
