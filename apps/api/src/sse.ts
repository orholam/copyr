import type { FastifyInstance } from "fastify";
import type { Core } from "@copyr/core";
import type { RealtimeEvent } from "@copyr/contracts";
import { startHijackedSse } from "./sse-cors.js";

/**
 * GET /api/v1/events — Server-Sent Events stream of workspace activity.
 * Backed by Postgres LISTEN/NOTIFY so it works across multiple instances.
 */
export async function registerSse(app: FastifyInstance, core: Core): Promise<void> {
  app.get("/api/v1/events", async (req, reply) => {
    const session = req.session;
    if (!session) return reply.status(401).send({ error: "unauthorized" });

    const raw = startHijackedSse(req, reply);
    raw.write(`retry: 2000\n\n`);
    raw.write(`event: ready\ndata: {"workspaceId":"${session.workspaceId}"}\n\n`);

    const unsubscribe = await core.ctx.bus.subscribe((payload) => {
      try {
        const event = JSON.parse(payload) as RealtimeEvent;
        if (event.workspaceId !== session.workspaceId) return;
        raw.write(`id: ${event.id}\n`);
        raw.write(`event: activity\n`);
        raw.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // malformed payload — skip
      }
    });

    const heartbeat = setInterval(() => {
      raw.write(`: ping ${Date.now()}\n\n`);
    }, 15_000);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.raw.on("close", close);
    req.raw.on("error", close);
    return reply;
  });
}
