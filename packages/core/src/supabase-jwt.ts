import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { CoreError } from "./context.js";

export interface SupabaseJwtClaims {
  sub: string;
  email: string | null;
  role: string;
  userMetadata: Record<string, unknown>;
}

export interface SupabaseJwtVerifyConfig {
  supabaseUrl?: string;
  jwtSecret?: string;
  anonKey?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jwksByUrl = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const verifiedCache = new Map<string, { claims: SupabaseJwtClaims; expMs: number }>();

function unauthorized(message = "invalid or expired session"): never {
  throw new CoreError(message, { code: "unauthorized", status: 401 });
}

function jwksFor(url: string) {
  const origin = url.replace(/\/$/, "");
  const cached = jwksByUrl.get(origin);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${origin}/auth/v1/.well-known/jwks.json`));
  jwksByUrl.set(origin, jwks);
  return jwks;
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function normalizeSupabaseClaims(payload: JWTPayload): SupabaseJwtClaims {
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  if (!UUID_RE.test(sub)) unauthorized("session is missing a user id");
  const role = typeof payload.role === "string" ? payload.role : "";
  if (role === "anon" || role === "service_role") {
    unauthorized("refusing non-user token");
  }
  const email = typeof payload.email === "string" && payload.email.includes("@") ? payload.email : null;
  return {
    sub,
    email,
    role: role || "authenticated",
    userMetadata: asMetadata(payload.user_metadata),
  };
}

async function verifyHs256(token: string, secret: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
    clockTolerance: 30,
  });
  return payload;
}

async function verifyAsymmetric(token: string, supabaseUrl: string): Promise<JWTPayload> {
  const origin = supabaseUrl.replace(/\/$/, "");
  const { payload } = await jwtVerify(token, jwksFor(origin), {
    issuer: `${origin}/auth/v1`,
    clockTolerance: 30,
  });
  return payload;
}

async function verifyViaAuthApi(
  token: string,
  supabaseUrl: string,
  anonKey: string,
): Promise<SupabaseJwtClaims> {
  const origin = supabaseUrl.replace(/\/$/, "");
  const res = await fetch(`${origin}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) unauthorized();
  const body = (await res.json()) as {
    id?: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
    role?: string;
  };
  if (!body.id || !UUID_RE.test(body.id)) unauthorized();
  return {
    sub: body.id,
    email: typeof body.email === "string" ? body.email : null,
    role: body.role || "authenticated",
    userMetadata: asMetadata(body.user_metadata),
  };
}

/**
 * Verify a Supabase Auth user access token.
 *
 * Prefers local verification (HS256 secret or project JWKS). Falls back to
 * `GET /auth/v1/user` when only the anon/publishable key is available — the
 * path Supabase documents for legacy shared-secret projects.
 */
export async function verifySupabaseJwt(
  token: string,
  cfg: SupabaseJwtVerifyConfig,
): Promise<SupabaseJwtClaims> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.split(".").length !== 3) unauthorized();

  const hit = verifiedCache.get(trimmed);
  if (hit && hit.expMs > Date.now() + 1_000) return hit.claims;

  if (!cfg.jwtSecret && !cfg.supabaseUrl) {
    throw new CoreError("Supabase auth is not configured", { code: "auth_not_configured", status: 503 });
  }

  let header: { alg?: string };
  try {
    header = decodeProtectedHeader(trimmed);
  } catch {
    unauthorized();
  }

  let payload: JWTPayload | undefined;
  const errors: string[] = [];

  if (header.alg === "HS256" && cfg.jwtSecret) {
    try {
      payload = await verifyHs256(trimmed, cfg.jwtSecret);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "hs256");
    }
  } else if (header.alg && header.alg !== "HS256" && cfg.supabaseUrl) {
    try {
      payload = await verifyAsymmetric(trimmed, cfg.supabaseUrl);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "jwks");
    }
  }

  let claims: SupabaseJwtClaims | undefined;
  if (payload) {
    claims = normalizeSupabaseClaims(payload);
  } else if (cfg.supabaseUrl && cfg.anonKey) {
    claims = await verifyViaAuthApi(trimmed, cfg.supabaseUrl, cfg.anonKey);
  } else if (errors.length) {
    unauthorized();
  } else {
    unauthorized("cannot verify access token (set SUPABASE_JWT_SECRET or SUPABASE_URL + SUPABASE_ANON_KEY)");
  }

  if (!claims) unauthorized();

  const expMs =
    typeof payload?.exp === "number" ? payload.exp * 1000 : Date.now() + 30_000;
  verifiedCache.set(trimmed, { claims, expMs });
  if (verifiedCache.size > 500) {
    const now = Date.now();
    for (const [k, v] of verifiedCache) {
      if (v.expMs < now) verifiedCache.delete(k);
    }
    if (verifiedCache.size > 500) {
      const first = verifiedCache.keys().next().value;
      if (first) verifiedCache.delete(first);
    }
  }
  return claims;
}

/** Test-only. */
export function resetSupabaseJwtCache(): void {
  verifiedCache.clear();
}
