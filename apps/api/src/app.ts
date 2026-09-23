import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { CoreError, createCore, type Core, type Session } from "@copyr/core";
import { isAllowedCorsOrigin, loadConfig } from "@copyr/config";
import { resolveSession } from "@copyr/core";

export interface AppRequest extends FastifyRequest {
  session?: Session;
  core?: Core;
}

declare module "fastify" {
  interface FastifyRequest {
    session?: Session;
  }
}

function bearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m?.[1] ?? null;
}

export async function buildApp(opts: { core?: Core } = {}) {
  const config = loadConfig();
  const core = opts.core ?? (await createCore({ runWorkers: process.env.API_RUN_WORKERS !== "false" }));

  const app = Fastify({
    logger:
      config.NODE_ENV === "production"
        ? true
        : { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } }, level: "info" },
    bodyLimit: 60 * 1024 * 1024, // decks are big
  });

  app.decorateRequest("session");
  app.addHook("onRequest", async (req) => {
    (req as unknown as { core: Core }).core = core;
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      cb(null, isAllowedCorsOrigin(origin, config));
    },
    credentials: true,
    // @fastify/cors defaults to CORS-safelisted methods only (GET, HEAD, POST).
    // Without an explicit list, SPA preflights for PATCH/PUT/DELETE fail even
    // when the Origin is allowed. Keep this list in sync with the HTTP verbs
    // the API actually serves.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Accept",
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Workspace-Slug",
      "X-Webhook-Secret",
    ],
  });
  await app.register(multipart, {
    limits: { fileSize: 100 * 1024 * 1024 },
  });
  // Per-plan tiers (Roulette changelog "smarter rate limiting").
  const PLAN_LIMITS: Record<string, number> = {
    trial: 120,
    monthly: 600,
    yearly: 1500,
    custom: 5000,
  };
  const planCache = new Map<string, { plan: string; at: number }>();
  const resolvePlan = async (req: FastifyRequest): Promise<string> => {
    const apiKey = typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : null;
    const accessToken = bearerToken(req.headers.authorization);
    const slug =
      (req.headers["x-workspace-slug"] as string | undefined) ?? config.DEV_WORKSPACE_SLUG;
    const cacheKey = apiKey ?? accessToken ?? slug;
    const cached = planCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 60_000) return cached.plan;
    try {
      const resolved = await (await import("@copyr/core")).resolveSession(core.ctx, {
        apiKey,
        accessToken,
        workspaceSlug: slug,
      });
      const ws = await core.session.getWorkspace(core.ctx, resolved.workspaceId);
      planCache.set(cacheKey, { plan: ws.plan, at: Date.now() });
      return ws.plan;
    } catch {
      return "trial";
    }
  };
  await app.register(import("@fastify/rate-limit").then((m) => m.default), {
    global: true,
    max: async (req: FastifyRequest) => {
      if (!req.url.startsWith("/api/")) return 10_000;
      const plan = await resolvePlan(req);
      return PLAN_LIMITS[plan] ?? 120;
    },
    timeWindow: "1 minute",
    hook: "onRequest",
    keyGenerator: (req) =>
      (req.headers.authorization as string | undefined) ??
      (req.headers["x-api-key"] as string | undefined) ??
      req.ip,
  });

  // ── error mapping ─────────────────────────────────────────────────
  app.setErrorHandler((rawErr, req, reply) => {
    const err = rawErr as Error & { statusCode?: number; validation?: unknown; issues?: unknown };
    if (err instanceof ZodError || (err as { name?: string }).name === "ZodError") {
      const zerr = err as unknown as ZodError;
      return reply.status(422).send({
        error: "Validation failed",
        code: "validation_error",
        details: zerr.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof CoreError) {
      return reply.status(err.status).send({ error: err.message, code: err.code, details: err.details });
    }
    if (err.validation) {
      return reply.status(400).send({ error: err.message, code: "bad_request" });
    }
    req.log.error(err);
    const status = err.statusCode ?? 500;
    return reply.status(status).send({
      error: status === 500 ? "Internal server error" : err.message,
      code: "internal_error",
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: `no route ${req.method} ${req.url}`, code: "not_found" });
  });

  // ── session resolution per request under /api/v1 ──────────────────
  app.addHook("preHandler", async (req: AppRequest, _reply: FastifyReply) => {
    if (!req.url.startsWith("/api/v1")) return;
    if (req.url.includes("/webhooks/inbound-email") || req.url.includes("/public/")) return; // webhook secret auth
    const apiKey = req.headers["x-api-key"];
    const slug = (req.headers["x-workspace-slug"] as string | undefined) ?? null;
    req.session = await resolveSession(core.ctx, {
      apiKey: typeof apiKey === "string" ? apiKey : null,
      accessToken: bearerToken(req.headers.authorization),
      workspaceSlug: slug,
    });
  });

  // ── assistant tool host: the FULL main MCP surface, in-process ────
  let mcpToolHost: import("@copyr/core").AssistantToolHost | undefined;
  try {
    const { createAssistantMcpBridge } = await import("@copyr/mcp");
    mcpToolHost = await createAssistantMcpBridge(core);
    app.log.info(`assistant bridged to main MCP (${(await mcpToolHost.listTools()).length} tools)`);
  } catch (err) {
    app.log.warn(`assistant falling back to built-in tool registry: ${err instanceof Error ? err.message : String(err)}`);
  }

  (app as unknown as { assistantToolHost: typeof mcpToolHost }).assistantToolHost = mcpToolHost;

  // ── routes ────────────────────────────────────────────────────────
  const { default: workspaceRoutes } = await import("./routes/workspace.js");
  const { default: pipelineRoutes } = await import("./routes/pipelines.js");
  const { default: fieldRoutes } = await import("./routes/fields.js");
  const { default: companyRoutes } = await import("./routes/companies.js");
  const { default: dealRoutes } = await import("./routes/deals.js");
  const { default: documentRoutes } = await import("./routes/documents.js");
  const { default: emailRoutes } = await import("./routes/emails.js");
  const { default: contentRoutes } = await import("./routes/content.js");
  const { default: analyticsRoutes } = await import("./routes/analytics.js");
  const { default: sharingRoutes } = await import("./routes/sharing.js");
  const { default: automationRoutes } = await import("./routes/automation.js");
  const { default: meRoutes } = await import("./routes/me.js");
  const { default: viewsRoutes } = await import("./routes/views.js");
  const { default: vaultRoutes } = await import("./routes/vaults.js");
  const { default: agentRoutes } = await import("./routes/agents.js");
  const { default: spaceRoutes } = await import("./routes/spaces.js");
  const { default: memoryRoutes } = await import("./routes/memory.js");
  const { default: researchRoutes } = await import("./routes/research.js");
  const { default: commandCenterRoutes } = await import("./routes/commandcenter.js");
  const { default: assistantRoutes } = await import("./routes/assistant.js");
  const { default: automationsOverviewRoutes } = await import("./routes/automations.js");
  const { registerSse } = await import("./sse.js");

  await app.register(workspaceRoutes, { prefix: "/api/v1" });
  await app.register(pipelineRoutes, { prefix: "/api/v1" });
  await app.register(fieldRoutes, { prefix: "/api/v1" });
  await app.register(companyRoutes, { prefix: "/api/v1" });
  await app.register(dealRoutes, { prefix: "/api/v1" });
  await app.register(documentRoutes, { prefix: "/api/v1" });
  await app.register(emailRoutes, { prefix: "/api/v1" });
  await app.register(contentRoutes, { prefix: "/api/v1" });
  await app.register(analyticsRoutes, { prefix: "/api/v1" });
  await app.register(sharingRoutes, { prefix: "/api/v1" });
  await app.register(automationRoutes, { prefix: "/api/v1" });
  await app.register(meRoutes, { prefix: "/api/v1" });
  await app.register(viewsRoutes, { prefix: "/api/v1" });
  await app.register(vaultRoutes, { prefix: "/api/v1" });
  await app.register(agentRoutes, { prefix: "/api/v1" });
  await app.register(spaceRoutes, { prefix: "/api/v1" });
  await app.register(memoryRoutes, { prefix: "/api/v1" });
  await app.register(researchRoutes, { prefix: "/api/v1" });
  await app.register(commandCenterRoutes, { prefix: "/api/v1" });
  await app.register(assistantRoutes, { prefix: "/api/v1" });
  await app.register(automationsOverviewRoutes, { prefix: "/api/v1" });
  await registerSse(app, core);

  // health
  app.get("/health", async () => ({
    ok: true,
    ts: new Date().toISOString(),
    workers: {
      enabled: core.workersEnabled,
      started: core.workersStarted,
    },
    aiProvider: config.AI_PROVIDER,
  }));

  // serve built SPA in production
  if (config.NODE_ENV === "production") {
    const { existsSync } = await import("node:fs");
    const webDist = new URL("../../web/dist/", import.meta.url).pathname;
    if (existsSync(webDist)) {
      const staticPlugin = (await import("@fastify/static")).default;
      await app.register(staticPlugin, { root: webDist, wildcard: false });
      app.setNotFoundHandler(async (req, reply) => {
        if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not found" });
        return reply.sendFile("index.html");
      });
    }
  }

  (app as unknown as { core: Core }).core = core;
  return app;
}
