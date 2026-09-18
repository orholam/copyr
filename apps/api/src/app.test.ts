import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { createApiKey, createCore, resolveSession, type Core, type Session } from "@copyr/core";

/**
 * Route-level tests over the real Fastify app via lightMyRequest (inject).
 * Infra tests always run; authenticated route tests skip cleanly when no
 * migrated database is reachable.
 */
describe("api", () => {
  let app: FastifyInstance;
  let core: Core;
  let dbUp = true;

  beforeAll(async () => {
    core = await createCore({ runWorkers: false });
    app = await buildApp({ core });
    try {
      await resolveSession(core.ctx, {});
    } catch {
      dbUp = false;
    }
  });

  afterAll(async () => {
    await app?.close();
    await core?.close();
  });

  describe("http surface (no infra)", () => {
    it("GET /health returns ok", async () => {
      const res = await app.inject({ method: "GET", url: "/health" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ ok: true });
    });

    it("unknown routes return a JSON 404 envelope", async () => {
      const res = await app.inject({ method: "GET", url: "/definitely-not-a-route" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "not_found" });
    });

    it("responds with content-type json for api errors", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1/missing" });
      expect(res.headers["content-type"]).toContain("application/json");
    });

    it("rejects a malformed bearer token without hitting slug fallback", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization: "Bearer not-a-jwt" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ code: "unauthorized" });
    });

    it("allows PATCH/PUT/DELETE on CORS preflight from an allowed SPA origin", async () => {
      const origin = "http://localhost:5173";
      const res = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/deals/00000000-0000-0000-0000-000000000001",
        headers: {
          origin,
          "access-control-request-method": "PATCH",
          "access-control-request-headers": "content-type,authorization",
        },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
      const allowMethods = String(res.headers["access-control-allow-methods"] ?? "").toUpperCase();
      expect(allowMethods).toContain("PATCH");
      expect(allowMethods).toContain("PUT");
      expect(allowMethods).toContain("DELETE");
    });

    it("omits Allow-Origin on CORS preflight from a disallowed origin", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/health",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "PATCH",
        },
      });
      expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("authenticated routes", () => {
    let headers: { "x-api-key": string };
    let agentSession: Session;
    let createdCompanyId: string | undefined;
    const companyName = `Api Test Co ${Date.now()}`;

    beforeAll(async () => {
      if (!dbUp) return;
      const devSession = await resolveSession(core.ctx, {});
      const key = await createApiKey(core.ctx, devSession, "route-tests");
      headers = { "x-api-key": key.secret };
      agentSession = await resolveSession(core.ctx, { apiKey: key.secret });
    });

    afterAll(async () => {
      if (!dbUp) return;
      if (createdCompanyId) {
        await core.companies
          .deleteCompany(core.ctx, agentSession, createdCompanyId)
          .catch(() => undefined);
      }
    });

    it("maps zod validation failures to a 422 with field details", async ({ skip }) => {
      if (!dbUp) skip();
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers,
        payload: { foundedYear: 1800 },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.code).toBe("validation_error");
      const paths = body.details.map((d: { path: string }) => d.path);
      expect(paths).toContain("name");
    });

    it("creates, reads, updates and deletes a company end-to-end", async ({ skip }) => {
      if (!dbUp) skip();
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/companies",
        headers,
        payload: { name: companyName, domain: "apitestco.example" },
      });
      expect(created.statusCode).toBe(200);
      const dto = created.json();
      expect(dto.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(dto.name).toBe(companyName);
      expect(dto.status).toBe("active");
      createdCompanyId = dto.id;

      const fetched = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${dto.id}`,
        headers,
      });
      expect(fetched.statusCode).toBe(200);
      expect(fetched.json().domain).toBe("apitestco.example");

      const patched = await app.inject({
        method: "PATCH",
        url: `/api/v1/companies/${dto.id}`,
        headers,
        payload: { sector: "AI/ML" },
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json().sector).toBe("AI/ML");

      const removed = await app.inject({
        method: "DELETE",
        url: `/api/v1/companies/${dto.id}`,
        headers,
      });
      expect(removed.statusCode).toBe(200);
      expect(removed.json()).toEqual({ ok: true });
      createdCompanyId = undefined;

      const gone = await app.inject({
        method: "GET",
        url: `/api/v1/companies/${dto.id}`,
        headers,
      });
      expect(gone.statusCode).toBe(404);
    });

    it("lists companies as a paginated envelope and filters by search", async ({ skip }) => {
      if (!dbUp) skip();
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/companies?q=${encodeURIComponent(companyName)}&limit=10`,
        headers,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(typeof body.total).toBe("number");
      // previous test deleted its company; the search should find none of it
      expect(body.items.find((c: { name: string }) => c.name === companyName)).toBeUndefined();
    });

    it("exposes workspace-level authority to api-key callers on /me", async ({ skip }) => {
      if (!dbUp) skip();
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/me/permissions",
        headers,
      });
      expect(res.statusCode).toBe(200);
      const permissions = res.json().permissions as string[];
      expect(permissions).toContain("manage_billing");
      expect(permissions).toContain("manage_pipeline");
    });

    it("includes Allow-Origin on hijacked SSE for an allowed Origin", async ({ skip }) => {
      if (!dbUp) skip();
      const origin = "http://localhost:5173";

      const events = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { ...headers, origin, accept: "text/event-stream" },
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
        headers: {
          ...headers,
          origin,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        payload: { content: "hello" },
      });
      expect(stream.statusCode).toBe(200);
      expect(String(stream.headers["content-type"] ?? "")).toContain("text/event-stream");
      expect(stream.headers["access-control-allow-origin"]).toBe(origin);
      expect(stream.headers["access-control-allow-credentials"]).toBe("true");
      expect(stream.headers["access-control-allow-origin"]).not.toBe("*");
    });

    it("omits Allow-Origin on hijacked SSE for a disallowed origin", async ({ skip }) => {
      if (!dbUp) skip();
      const origin = "https://evil.example";

      const events = await app.inject({
        method: "GET",
        url: "/api/v1/events",
        headers: { ...headers, origin, accept: "text/event-stream" },
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
        headers: {
          ...headers,
          origin,
          "content-type": "application/json",
          accept: "text/event-stream",
        },
        payload: { content: "hello" },
      });
      expect(stream.statusCode).toBe(200);
      expect(String(stream.headers["content-type"] ?? "")).toContain("text/event-stream");
      expect(stream.headers["access-control-allow-origin"]).toBeUndefined();
      expect(stream.headers["access-control-allow-credentials"]).toBeUndefined();
    });
  });
});
