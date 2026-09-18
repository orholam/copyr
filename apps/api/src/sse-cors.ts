import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";
import type { FastifyReply, FastifyRequest } from "fastify";
import { isAllowedCorsOrigin, loadConfig, type AppConfig } from "@copyr/config";

function requestOrigin(headers: IncomingHttpHeaders): string | undefined {
  const raw = headers.origin;
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string" && raw[0].length > 0) return raw[0];
  return undefined;
}

/**
 * CORS headers for responses that skip Fastify's onSend hook
 * (`reply.hijack()` + `raw.writeHead`).
 *
 * Reflects Origin when allowed; never uses `*` with credentials.
 */
export function corsHeadersForHijackedReply(
  requestHeaders: IncomingHttpHeaders,
  cfg: AppConfig = loadConfig(),
): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = { vary: "Origin" };
  const origin = requestOrigin(requestHeaders);
  if (origin && isAllowedCorsOrigin(origin, cfg)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-credentials"] = "true";
  }
  return headers;
}

const SSE_HEADERS: OutgoingHttpHeaders = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

/** Hijack the reply and write SSE headers including CORS for the request Origin. */
export function startHijackedSse(req: FastifyRequest, reply: FastifyReply): FastifyReply["raw"] {
  reply.hijack();
  reply.raw.writeHead(200, {
    ...SSE_HEADERS,
    ...corsHeadersForHijackedReply(req.headers),
  });
  return reply.raw;
}
