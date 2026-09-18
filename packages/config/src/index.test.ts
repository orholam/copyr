import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { loadConfig, resetConfigCache } from "./index.js";

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
});
