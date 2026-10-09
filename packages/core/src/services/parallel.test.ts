import { describe, expect, it } from "vitest";
import { parseParallelProfile } from "./parallel.js";

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
