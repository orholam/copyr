import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import type { AppConfig } from "@copyr/config";
import { CoreError } from "../context.js";

export interface VerifiedAuthUser {
  id: string;
  email: string;
  name: string;
  /** Display-only (from user_metadata at provision time). Never used for authorization. */
  firmName?: string;
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function unauthorized(message = "invalid or expired session"): never {
  throw new CoreError(message, { code: "unauthorized", status: 401 });
}

function issuerFor(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/auth/v1`;
}

function jwksFor(supabaseUrl: string) {
  const issuer = issuerFor(supabaseUrl);
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

function displayName(payload: JWTPayload, email: string): string {
  const meta = payload.user_metadata;
  if (meta && typeof meta === "object") {
    const record = meta as Record<string, unknown>;
    for (const key of ["full_name", "name", "display_name"]) {
      const v = record[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  const local = email.split("@")[0]?.trim();
  return local || "Member";
}

function firmNameFrom(payload: JWTPayload): string | undefined {
  const meta = payload.user_metadata;
  if (!meta || typeof meta !== "object") return undefined;
  const v = (meta as Record<string, unknown>).firm_name;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asVerified(payload: JWTPayload): VerifiedAuthUser {
  if (payload.role && payload.role !== "authenticated") {
    unauthorized("token is not an authenticated user session");
  }
  const id = typeof payload.sub === "string" ? payload.sub : "";
  if (!id) unauthorized("token missing subject");
  const emailRaw = payload.email;
  const email = typeof emailRaw === "string" ? emailRaw.trim().toLowerCase() : "";
  if (!email) unauthorized("token missing email");
  return {
    id,
    email,
    name: displayName(payload, email),
    firmName: firmNameFrom(payload),
  };
}

async function verifyHs256(token: string, config: AppConfig): Promise<JWTPayload> {
  if (!config.SUPABASE_JWT_SECRET) unauthorized("HS256 token requires SUPABASE_JWT_SECRET");
  const { payload } = await jwtVerify(token, new TextEncoder().encode(config.SUPABASE_JWT_SECRET), {
    issuer: config.SUPABASE_URL ? issuerFor(config.SUPABASE_URL) : undefined,
    audience: "authenticated",
    clockTolerance: 30,
  });
  return payload;
}

async function verifyJwks(token: string, config: AppConfig): Promise<JWTPayload> {
  if (!config.SUPABASE_URL) unauthorized("JWKS verification requires SUPABASE_URL");
  const { payload } = await jwtVerify(token, jwksFor(config.SUPABASE_URL), {
    issuer: issuerFor(config.SUPABASE_URL),
    audience: "authenticated",
    clockTolerance: 30,
  });
  return payload;
}

/**
 * Last-resort check against the Auth server. Used when the token is HS256 but
 * the JWT secret is not on this host (GoTrue GET /user).
 */
async function verifyViaAuthApi(token: string, config: AppConfig): Promise<VerifiedAuthUser> {
  if (!config.SUPABASE_URL || !config.SUPABASE_ANON_KEY) {
    unauthorized("cannot validate token (set SUPABASE_JWT_SECRET or SUPABASE_ANON_KEY)");
  }
  const res = await fetch(`${config.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      authorization: `Bearer ${token}`,
      apikey: config.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) unauthorized();
  const body = (await res.json()) as { id?: string; email?: string; user_metadata?: Record<string, unknown> };
  if (!body.id || !body.email) unauthorized();
  const email = body.email.trim().toLowerCase();
  const meta = body.user_metadata ?? {};
  const name =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    email.split("@")[0] ||
    "Member";
  const firm =
    typeof meta.firm_name === "string" && meta.firm_name.trim() ? meta.firm_name.trim() : undefined;
  return { id: body.id, email, name, firmName: firm };
}

export function supabaseAuthConfigured(config: AppConfig): boolean {
  return Boolean(config.SUPABASE_URL || config.SUPABASE_JWT_SECRET);
}

/**
 * Verify a Supabase Auth access token (ES256 JWKS, HS256 shared secret, or Auth API).
 * Rejects the legacy anon key (`role: anon`) so it cannot be used as a user session.
 */
export async function verifySupabaseAccessToken(
  config: AppConfig,
  token: string,
): Promise<VerifiedAuthUser> {
  const trimmed = token.trim();
  if (!trimmed) unauthorized();
  if (!supabaseAuthConfigured(config) && !config.SUPABASE_ANON_KEY) {
    unauthorized("bearer token provided but Supabase auth is not configured on the API");
  }

  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(trimmed).alg;
  } catch {
    unauthorized("malformed access token");
  }

  try {
    if (alg === "HS256") {
      if (config.SUPABASE_JWT_SECRET) {
        return asVerified(await verifyHs256(trimmed, config));
      }
      return await verifyViaAuthApi(trimmed, config);
    }
    if (config.SUPABASE_URL) {
      return asVerified(await verifyJwks(trimmed, config));
    }
    if (config.SUPABASE_JWT_SECRET) {
      return asVerified(await verifyHs256(trimmed, config));
    }
    return await verifyViaAuthApi(trimmed, config);
  } catch (err) {
    if (err instanceof CoreError) throw err;
    unauthorized();
  }
}
