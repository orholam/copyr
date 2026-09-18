import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { loadConfig, resetConfigCache, isAllowedCorsOrigin } from "./index.js";

describe("loadConfig", () => {
  it("applies and coerces explicit overrides", () => {
    const cfg = loadConfig({
      DATABASE_URL: "postgres://test:test@localhost:5999/test",
      JOB_CONCURRENCY: "7",
      AI_PROVIDER: "mock",
      NODE_ENV: "test",
    });
    expect(cfg.DATABASE_URL).toBe("postgres://test:test@localhost:5999/test");
    expect(cfg.JOB_CONCURRENCY).toBe(7);
    expect(cfg.NODE_ENV).toBe("test");
    expect(typeof cfg.API_PORT).toBe("number");
  });

  it("falls back to defaults for unset optional values", () => {
    const cfg = loadConfig({ NODE_ENV: "test" });
    expect(cfg.STORAGE_REGION).toBe("us-east-1");
    expect(cfg.AI_CREDITS_MONTHLY_GRANT).toBeGreaterThan(0);
    expect(cfg.INBOUND_WEBHOOK_SECRET.length).toBeGreaterThan(0);
  });

  it("rejects non-postgres database urls", () => {
    expect(() => loadConfig({ DATABASE_URL: "mysql://nope/nope" })).toThrow(ZodError);
  });

  it("caches the first no-override call", () => {
    const a = loadConfig();
    const b = loadConfig();
    expect(b).toBe(a);
  });

  it("resetConfigCache forces a fresh parse", () => {
    const before = loadConfig();
    resetConfigCache();
    const after = loadConfig();
    expect(after).not.toBe(before);
    expect(after).toEqual(before);
  });

  it("treats blank DATABASE_POOL_URL as unset", () => {
    const cfg = loadConfig({ NODE_ENV: "test", DATABASE_POOL_URL: "" });
    expect(cfg.DATABASE_POOL_URL).toBeUndefined();
  });

  it("accepts a supabase pooler URL", () => {
    const url =
      "postgresql://postgres.cdsngnauduhiaidzncie:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
    const cfg = loadConfig({ NODE_ENV: "test", DATABASE_POOL_URL: url });
    expect(cfg.DATABASE_POOL_URL).toBe(url);
  });

  it("does not default MinIO endpoint in production when storage is unset", () => {
    const cfg = loadConfig({ NODE_ENV: "production", STORAGE_ENDPOINT: "" });
    expect(cfg.STORAGE_ENDPOINT).toBeUndefined();
  });

  it("parses falsey env booleans", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      AUTO_MIGRATE: "false",
      CORS_ALLOW_VERCEL_PREVIEWS: "0",
    });
    expect(cfg.AUTO_MIGRATE).toBe(false);
    expect(cfg.CORS_ALLOW_VERCEL_PREVIEWS).toBe(false);
  });
});

describe("isAllowedCorsOrigin", () => {
  it("allows WEB_URL and localhost", () => {
    const cfg = loadConfig({ NODE_ENV: "test", WEB_URL: "https://copyr-demo.vercel.app" });
    expect(isAllowedCorsOrigin("https://copyr-demo.vercel.app", cfg)).toBe(true);
    expect(isAllowedCorsOrigin("http://localhost:5173", cfg)).toBe(true);
    expect(isAllowedCorsOrigin("https://evil.example", cfg)).toBe(false);
  });

  it("honors CORS_ORIGINS and vercel preview flag", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      WEB_URL: "https://copyr-demo.vercel.app",
      CORS_ORIGINS: "https://copyr.example.com",
      CORS_ALLOW_VERCEL_PREVIEWS: "true",
    });
    expect(isAllowedCorsOrigin("https://copyr.example.com", cfg)).toBe(true);
    expect(isAllowedCorsOrigin("https://copyr-git-main-team.vercel.app", cfg)).toBe(true);
    expect(isAllowedCorsOrigin("https://not-vercel.example", cfg)).toBe(false);
  });
});
