import { describe, it, expect, afterAll } from "vitest";
import { CoreError, createCoreContext } from "./context.js";
import { loadConfig } from "@copyr/config";

describe("CoreError", () => {
  it("defaults to a 400 core_error", () => {
    const err = new CoreError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("boom");
    expect(err.code).toBe("core_error");
    expect(err.status).toBe(400);
    expect(err.details).toBeUndefined();
  });

  it("carries code, status and details through to HTTP mapping", () => {
    const err = new CoreError('workspace "x" not found', {
      code: "no_workspace",
      status: 404,
      details: { slug: "x" },
    });
    expect(err.code).toBe("no_workspace");
    expect(err.status).toBe(404);
    expect(err.details).toEqual({ slug: "x" });
  });
});

function makeDeps(boss?: unknown) {
  return {
    db: {} as never,
    storage: {} as never,
    ai: {} as never,
    config: loadConfig({ NODE_ENV: "test" }),
    ...(boss ? { boss: boss as never } : {}),
  };
}

describe("createCoreContext", () => {
  const ctx = createCoreContext(makeDeps());

  afterAll(async () => {
    await ctx.bus.close();
  });

  it("enqueue is a no-op returning undefined without pg-boss", async () => {
    await expect(ctx.enqueue("convert-link", { documentId: "d1" })).resolves.toBeUndefined();
  });

  it("exposes the realtime bus for SSE fan-out", () => {
    expect(ctx.bus).toBeDefined();
  });

  it("forwards jobs to pg-boss when provided", async () => {
    const sent: Array<{ queue: string; data: unknown }> = [];
    const bossCtx = createCoreContext(
      makeDeps({
        send: async (queue: string, data: unknown) => {
          sent.push({ queue, data });
          return "job-1";
        },
      }),
    );
    const jobId = await bossCtx.enqueue("triage-email", { emailId: "e1" });
    expect(jobId).toBe("job-1");
    expect(sent).toEqual([{ queue: "triage-email", data: { emailId: "e1" } }]);
    // second context owns its own bus; close it too
    await bossCtx.bus.close();
  });

  it("maps null pg-boss job ids to undefined", async () => {
    const bossCtx = createCoreContext(makeDeps({ send: async () => null }));
    await expect(bossCtx.enqueue("q", {})).resolves.toBeUndefined();
    await bossCtx.bus.close();
  });
});
