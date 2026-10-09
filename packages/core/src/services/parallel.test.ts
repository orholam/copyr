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
      }),
    ).toEqual({
      description: "Builds grid batteries.",
      sector: "Climate",
      location: "Austin, TX",
      foundedYear: 2019,
      employeeCount: 42,
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
