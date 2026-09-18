import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { loadConfig } from "@copyr/config";
import type { Core, Session } from "@copyr/core";
import { corsHeadersForHijackedReply } from "./sse-cors.js";
import { registerSse } from "./sse.js";
import assistantRoutes from "./routes/assistant.js";

describe("corsHeadersForHijackedReply", () => {
  const cfg = loadConfig({ NODE_ENV: "test" });

  it("reflects an allowed Origin and sets credentials + Vary", () => {
    const headers = corsHeadersForHijackedReply({ origin: "http://localhost:5173" }, cfg);
    expect(headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(headers["access-control-allow-credentials"]).toBe("true");
    expect(headers.vary).toBe("Origin");
    expect(headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("omits Allow-Origin for a disallowed origin", () => {
    const headers = corsHeadersForHijackedReply({ origin: "https://evil.example" }, cfg);
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers["access-control-allow-credentials"]).toBeUndefined();
    expect(headers.vary).toBe("Origin");
  });

  it("omits Allow-Origin when the request has no Origin", () => {
    const headers = corsHeadersForHijackedReply({}, cfg);
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers.vary).toBe("Origin");
  });
});

describe("hijacked SSE responses", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest("session");
    app.addHook("onRequest", async (req) => {
      req.session = {
        workspaceId: "00000000-0000-0000-0000-000000000001",
        actor: { userId: null, source: "api" },
      } as Session;
    });
    const core = {
      ctx: {
        bus: {
          subscribe: async () => () => undefined,
        },
      },
      assistant: {
        streamMessage: async (
          _ctx: unknown,
          _session: unknown,
          _conversationId: string | null,
          _content: string,
          _host: unknown,
          send: (evt: Record<string, unknown> & { type: string }) => void,
        ) => {
          send({ type: "token", text: "hi" });
          return { conversation: { id: "c1" }, messages: [] };
        },
      },
    };
    (app as unknown as { core: typeof core }).core = core;
    await registerSse(app, core as unknown as Core);
    await app.register(assistantRoutes, { prefix: "/api/v1" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("includes Allow-Origin on /events and chat stream for an allowed Origin", async () => {
    const origin = "http://localhost:5173";
    const events = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: { origin, accept: "text/event-stream" },
      payloadAsStream: true,
    });
    try {
      expect(events.statusCode).toBe(200);
      expect(String(events.headers["content-type"] ?? "")).toContain("text/event-stream");
      expect(events.headers["access-control-allow-origin"]).toBe(origin);
      expect(events.headers["access-control-allow-credentials"]).toBe("true");
      expect(String(events.headers.vary ?? "")).toMatch(/origin/i);
    } finally {
        events.raw.res.destroy();
    }

    const stream = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/messages/stream",
      headers: { origin, "content-type": "application/json", accept: "text/event-stream" },
      payload: { content: "hello" },
    });
    expect(stream.statusCode).toBe(200);
    expect(String(stream.headers["content-type"] ?? "")).toContain("text/event-stream");
    expect(stream.headers["access-control-allow-origin"]).toBe(origin);
    expect(stream.headers["access-control-allow-credentials"]).toBe("true");
    expect(stream.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("omits Allow-Origin on /events and chat stream for a disallowed origin", async () => {
    const origin = "https://evil.example";
    const events = await app.inject({
      method: "GET",
      url: "/api/v1/events",
      headers: { origin, accept: "text/event-stream" },
      payloadAsStream: true,
    });
    try {
      expect(events.statusCode).toBe(200);
      expect(String(events.headers["content-type"] ?? "")).toContain("text/event-stream");
      expect(events.headers["access-control-allow-origin"]).toBeUndefined();
      expect(events.headers["access-control-allow-credentials"]).toBeUndefined();
    } finally {
        events.raw.res.destroy();
    }

    const stream = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/messages/stream",
      headers: { origin, "content-type": "application/json", accept: "text/event-stream" },
      payload: { content: "hello" },
    });
    expect(stream.statusCode).toBe(200);
    expect(String(stream.headers["content-type"] ?? "")).toContain("text/event-stream");
    expect(stream.headers["access-control-allow-origin"]).toBeUndefined();
    expect(stream.headers["access-control-allow-credentials"]).toBeUndefined();
  });
});
