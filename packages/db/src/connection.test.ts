import { describe, it, expect } from "vitest";
import { pgSsl, queryDatabaseUrl } from "./connection.js";

describe("pgSsl", () => {
  it("is off for local docker urls in auto mode", () => {
    expect(pgSsl("postgres://copyr:copyr@localhost:5433/copyr", "auto")).toBeUndefined();
  });

  it("enables TLS for supabase hosts", () => {
    expect(pgSsl("postgresql://postgres:x@db.cdsngnauduhiaidzncie.supabase.co:5432/postgres", "auto")).toEqual({
      rejectUnauthorized: false,
    });
    expect(
      pgSsl(
        "postgresql://postgres.cdsngnauduhiaidzncie:x@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
        "auto",
      ),
    ).toEqual({ rejectUnauthorized: false });
  });

  it("honors explicit require / disable", () => {
    expect(pgSsl("postgres://copyr:copyr@localhost:5433/copyr", "require")).toEqual({
      rejectUnauthorized: false,
    });
    expect(pgSsl("postgresql://postgres:x@db.x.supabase.co:5432/postgres", "disable")).toBeUndefined();
  });
});

describe("queryDatabaseUrl", () => {
  it("prefers the pooler when set", () => {
    expect(
      queryDatabaseUrl({
        DATABASE_URL: "postgres://session/db",
        DATABASE_POOL_URL: "postgres://pool/db",
      }),
    ).toBe("postgres://pool/db");
  });
});
