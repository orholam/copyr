import { describe, it, expect } from "vitest";
import {
  idSchema,
  moneySchema,
  nullableMoney,
  paginationSchema,
  paginated,
  entitySourceSchema,
  companyStatusSchema,
  stageKindSchema,
  fieldTargetSchema,
  fieldTypeSchema,
  memberRoleSchema,
  fieldValuePrimitive,
  setFieldValueSchema,
  actorSchema,
} from "./common.js";

describe("paginationSchema", () => {
  it("applies defaults when fields are missing", () => {
    const out = paginationSchema.parse({});
    expect(out).toEqual({ limit: 50, offset: 0 });
  });

  it("coerces string query params to integers", () => {
    const out = paginationSchema.parse({ limit: "25", offset: "5" });
    expect(out).toEqual({ limit: 25, offset: 5 });
  });

  it("rejects out-of-range and non-numeric values", () => {
    expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(paginationSchema.safeParse({ limit: 201 }).success).toBe(false);
    expect(paginationSchema.safeParse({ limit: "abc" }).success).toBe(false);
    expect(paginationSchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("paginated()", () => {
  const envelope = paginated(idSchema);

  it("accepts a valid envelope", () => {
    const out = envelope.parse({
      items: ["3f2504e0-4f89-11d3-9a0c-0305e82c3301"],
      total: 1,
      limit: 50,
      offset: 0,
    });
    expect(out.items).toHaveLength(1);
  });

  it("rejects envelopes missing total or with wrong item types", () => {
    expect(envelope.safeParse({ items: [], limit: 50, offset: 0 }).success).toBe(false);
    expect(envelope.safeParse({ items: ["nope"], total: 1, limit: 50, offset: 0 }).success).toBe(
      false,
    );
  });
});

describe("money", () => {
  it("rejects negative amounts", () => {
    expect(moneySchema.safeParse(-1).success).toBe(false);
    expect(moneySchema.parse(0)).toBe(0);
  });

  it("nullableMoney allows null and undefined but not strings", () => {
    expect(nullableMoney.safeParse(null).success).toBe(true);
    expect(nullableMoney.safeParse(undefined).success).toBe(true);
    expect(nullableMoney.safeParse("12").success).toBe(false);
  });
});

describe("enums mirror DB values", () => {
  it("companyStatus accepts known statuses only", () => {
    for (const s of ["active", "portfolio", "passed", "archived"]) {
      expect(companyStatusSchema.safeParse(s).success).toBe(true);
    }
    expect(companyStatusSchema.safeParse("deleted").success).toBe(false);
  });

  it("stageKind / fieldTarget / memberRole reject unknown values", () => {
    expect(stageKindSchema.safeParse("active").success).toBe(true);
    expect(stageKindSchema.safeParse("pending").success).toBe(false);
    expect(fieldTargetSchema.safeParse("deal").success).toBe(true);
    expect(fieldTargetSchema.safeParse("note").success).toBe(false);
    expect(memberRoleSchema.safeParse("owner").success).toBe(true);
    expect(memberRoleSchema.safeParse("superuser").success).toBe(false);
  });

  it("fieldType covers all supported column types", () => {
    const expected = [
      "text",
      "long_text",
      "number",
      "currency",
      "select",
      "multi_select",
      "date",
      "url",
      "checkbox",
    ];
    for (const t of expected) {
      expect(fieldTypeSchema.safeParse(t).success).toBe(true);
    }
  });

  it("entitySource rejects sources outside the pipeline", () => {
    expect(entitySourceSchema.safeParse("email").success).toBe(true);
    expect(entitySourceSchema.safeParse("scraped").success).toBe(false);
  });
});

describe("fieldValuePrimitive", () => {
  it("allows primitives and string arrays, nothing richer", () => {
    expect(fieldValuePrimitive.safeParse("x").success).toBe(true);
    expect(fieldValuePrimitive.safeParse(3).success).toBe(true);
    expect(fieldValuePrimitive.safeParse(false).success).toBe(true);
    expect(fieldValuePrimitive.safeParse(["a", "b"]).success).toBe(true);
    expect(fieldValuePrimitive.safeParse([1]).success).toBe(false);
    expect(fieldValuePrimitive.safeParse({ a: 1 }).success).toBe(false);
    expect(fieldValuePrimitive.safeParse(null).success).toBe(false);
  });
});

describe("setFieldValueSchema", () => {
  it("requires a key and allows null to clear a value", () => {
    expect(setFieldValueSchema.parse({ key: "arr", value: null })).toEqual({
      key: "arr",
      value: null,
    });
    expect(setFieldValueSchema.safeParse({ value: 1 }).success).toBe(false);
    expect(setFieldValueSchema.safeParse({ key: "arr", value: { nested: true } }).success).toBe(
      false,
    );
  });
});

describe("actorSchema", () => {
  it("defaults to a system-side api actor with null userId", () => {
    expect(actorSchema.parse({})).toEqual({ userId: null, source: "api" });
  });

  it("validates userId as uuid and source against known origins", () => {
    const actor = actorSchema.parse({
      userId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301",
      source: "agent",
    });
    expect(actor.source).toBe("agent");
    expect(actorSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(false);
    expect(actorSchema.safeParse({ source: "cron" }).success).toBe(false);
  });
});
