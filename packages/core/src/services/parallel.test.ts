import { describe, expect, it } from "vitest";
import { parallelRunStillActive, parseParallelProfile, readParallelError } from "./parallel.js";

describe("parseParallelProfile", () => {
  it("keeps a researched company profile", () => {
    expect(
      parseParallelProfile({
        description: "Builds grid batteries.",
        sector: "Climate",
        location: "Austin, TX",
        founded_year: 2019,
        employee_count: 42,
        latest_round: "Series A",
        ask_usd: 12_000_000,
        valuation_usd: 48_000_000,
        linkedin_url: "linkedin.com/company/grid",
        founders: [{ name: "Ada Lovelace", title: "CEO" }, { name: "Ada Lovelace", title: "duplicate" }],
      }),
    ).toEqual({
      description: "Builds grid batteries.",
      sector: "Climate",
      location: "Austin, TX",
      foundedYear: 2019,
      employeeCount: 42,
      latestRound: "Series A",
      askUsd: 12_000_000,
      valuationUsd: 48_000_000,
      linkedinUrl: "https://linkedin.com/company/grid",
      founders: [{ name: "Ada Lovelace", title: "CEO" }],
    });
  });

  it("reads a still-active run out of Parallel's nested error", () => {
    const body = {
      type: "error",
      error: { ref_id: "abc", message: "Run still active.", detail: null },
    };
    const message = readParallelError(body, JSON.stringify(body));
    expect(message).toBe("Run still active.");
    expect(parallelRunStillActive(408, message)).toBe(true);
  });

  it("drops unknown or nonsense numbers", () => {
    expect(
      parseParallelProfile({
        description: "",
        sector: "",
        location: "",
        founded_year: null,
        employee_count: "many",
      }),
    ).toBeNull();
  });
});
