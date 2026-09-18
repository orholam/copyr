import { describe, it, expect } from "vitest";
import { creditCost, type CreditReason } from "./credits.js";

describe("creditCost", () => {
  it("prices AI-consuming actions", () => {
    expect(creditCost("deck_extraction")).toBe(2);
    expect(creditCost("email_triage")).toBe(1);
    expect(creditCost("update_classification")).toBe(1);
    expect(creditCost("assistant_turn")).toBe(1);
    expect(creditCost("link_conversion")).toBe(1);
    expect(creditCost("vault_review")).toBe(3);
    expect(creditCost("research_report")).toBe(4);
    expect(creditCost("agent_run")).toBe(5);
  });

  it("grants and manual adjustments are free", () => {
    for (const reason of ["monthly_grant", "signup_grant", "manual_adjustment"] as CreditReason[]) {
      expect(creditCost(reason)).toBe(0);
    }
  });
});
