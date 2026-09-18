import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import type { RawReplyDefaultExpression, RawRequestDefaultExpression } from "fastify";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadConfig } from "@copyr/config";
import { createCore, resolveSession, CoreError } from "@copyr/core";
import type { Session } from "@copyr/core";
import { createCopyrMcpServer } from "./server.js";
import { runWithSession } from "./session.js";

/**
 * Streamable-HTTP MCP endpoint for remote agents.
 *
 *   POST   /mcp   JSON-RPC (initialize first → mcp-session-id header issued)
 *   GET    /mcp   optional SSE upstream channel
 *   DELETE /mcp   terminate session
 *
 * Auth per request: `Authorization: Bearer` (Supabase JWT), `X-API-Key`, or
 * `X-Workspace-Slug` when ALLOW_DEV_WORKSPACE_AUTH is on.
 * A given MCP session is bound to the tenant that initialized it.
 */

interface McpHttpSession {
  id: string;
  workspaceId: string;
  mcp: McpServer;
  transport: StreamableHTTPServerTransport;
}

async function main() {
  loadConfig();
  const core = await createCore({ runWorkers: false });
  const sessions = new Map<string, McpHttpSession>();

  async function resolveTenant(headers: Record<string, string | string[] | undefined>): Promise<Session> {
    const apiKey = typeof headers["x-api-key"] === "string" ? headers["x-api-key"] : null;
    const slug = typeof headers["x-workspace-slug"] === "string" ? headers["x-workspace-slug"] : null;
    const auth = headers.authorization;
    const accessToken =
      typeof auth === "string" && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "").trim() : null;
    return resolveSession(core.ctx, { apiKey, workspaceSlug: slug, accessToken });
  }

  async function createSession(session: Session): Promise<McpHttpSession> {
    const mcp = createCopyrMcpServer(core);
    let httpSession: McpHttpSession | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (id) => {
        httpSession = { id, workspaceId: session.workspaceId, mcp, transport };
        sessions.set(id, httpSession);
      },
    });
    await mcp.connect(transport);
    return { id: "", workspaceId: session.workspaceId, mcp, transport };
  }

  const app = Fastify({ logger: { level: "warn" }, bodyLimit: 60 * 1024 * 1024 });

  app.post("/mcp", async (req, reply) => {
    try {
      const body = req.body as { method?: string };
      const sid = req.headers["mcp-session-id"] as string | undefined;
      const httpSession = sid ? sessions.get(sid) : undefined;

      if (!httpSession) {
        // new session must start with initialize
        const session = await resolveTenant(req.headers);
        const created = await createSession(session);
        if (body.method !== "initialize") {
          // stateless-ish convenience: allow direct calls by binding this
          // single request to an ad-hoc session (agents that skip handshake)
          reply.hijack();
          await runWithSession(session, () =>
            created.transport.handleRequest(req.raw, reply.raw as RawReplyDefaultExpression, req.body),
          );
          return reply;
        }
        reply.hijack();
        await runWithSession(session, () =>
          created.transport.handleRequest(req.raw, reply.raw as RawReplyDefaultExpression, req.body),
        );
        return reply;
      }

      // existing session — verify tenant consistency when slug/key provided
      const session = await resolveTenant(req.headers);
      if (session.workspaceId !== httpSession.workspaceId) {
        return reply.status(403).send({ error: "session belongs to another workspace" });
      }
      reply.hijack();
      await runWithSession(session, () =>
        httpSession!.transport.handleRequest(
          req.raw as RawRequestDefaultExpression,
          reply.raw as RawReplyDefaultExpression,
          req.body,
        ),
      );
      return reply;
    } catch (err) {
      if (err instanceof CoreError) {
        return reply.status(err.status).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  app.get("/mcp", async (req, reply) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    const httpSession = sid ? sessions.get(sid) : undefined;
    if (!httpSession) return reply.status(404).send({ error: "unknown session" });
    const session = await resolveTenant(req.headers);
    reply.hijack();
    await runWithSession(session, () =>
      httpSession.transport.handleRequest(
        req.raw as RawRequestDefaultExpression,
        reply.raw as RawReplyDefaultExpression,
      ),
    );
    return reply;
  });

  app.delete("/mcp", async (req, reply) => {
    const sid = req.headers["mcp-session-id"] as string | undefined;
    const httpSession = sid ? sessions.get(sid) : undefined;
    if (httpSession) {
      await httpSession.transport.close?.().catch(() => undefined);
      sessions.delete(httpSession.id);
    }
    return reply.status(204).send();
  });

  app.get("/health", async () => ({ ok: true, sessions: sessions.size }));

  const port = Number(process.env.MCP_HTTP_PORT ?? 4200);
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`Copyr MCP (streamable HTTP) listening on http://localhost:${port}/mcp`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
