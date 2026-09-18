import { describe, it, expect } from "vitest";
import { isCopyrDealsTable, shouldPreserveNonCopyrDeals, renameDealsIdent } from "./prepare-target.js";

describe("scaffold deals detection", () => {
  it("recognizes Copyr deals columns", () => {
    expect(isCopyrDealsTable(["id", "workspace_id", "company_id", "pipeline_id", "stage_id", "title"])).toBe(
      true,
    );
    expect(shouldPreserveNonCopyrDeals(["id", "workspace_id", "pipeline_id", "stage_id"])).toBe(false);
  });

  it("flags a thin scaffold table for rename (never drop)", () => {
    expect(shouldPreserveNonCopyrDeals(["id", "created_at", "name"])).toBe(true);
    expect(shouldPreserveNonCopyrDeals(["id", "title"])).toBe(true);
    expect(shouldPreserveNonCopyrDeals([])).toBe(false);
  });

  it("renames deals_* identifiers onto the scaffold table", () => {
    expect(renameDealsIdent("deals_pkey", "deals_scaffold")).toBe("deals_scaffold_pkey");
    expect(renameDealsIdent("deals_scaffold_pkey", "deals_scaffold")).toBe("deals_scaffold_pkey");
  });
});
