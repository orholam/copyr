import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { companies } from "./schema.js";

const mergeColumns = [
  "pipeline_id",
  "stage_id",
  "owner_user_id",
  "round_stage",
  "ask_amount",
  "valuation",
  "priority",
  "position",
  "next_step_at",
  "archived_at",
  "source_ref",
] as const;

const sqlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/sql/hotfix-companies-pipeline-columns.sql",
);

describe("hotfix-companies-pipeline-columns.sql", () => {
  const sql = readFileSync(sqlPath, "utf8");
  const schemaCols = getTableColumns(companies);

  it("covers every company-deal merge column on schema.ts companies", () => {
    for (const name of mergeColumns) {
      const col = Object.values(schemaCols).find((c) => c.name === name);
      expect(col, `schema.ts is missing ${name}`).toBeDefined();
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${name}`);
    }
  });

  it("matches schema.ts types for the columns that caused the Render 500s", () => {
    expect(schemaCols.archivedAt.columnType).toBe("PgTimestamp");
    expect(schemaCols.archivedAt.dataType).toBe("date");
    expect(schemaCols.stageId.columnType).toBe("PgUUID");
    expect(schemaCols.stageId.notNull).toBe(true);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS archived_at timestamp with time zone/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stage_id uuid/);
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS companies_stage_idx");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS companies_ws_pipeline_idx");
  });
});
