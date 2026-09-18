import { describe, it, expect, beforeEach } from "vitest";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import {
  normalizeSupabaseClaims,
  resetSupabaseJwtCache,
  verifySupabaseJwt,
} from "./supabase-jwt.js";
import { CoreError } from "./context.js";

const SECRET = "test-jwt-secret-32-bytes-minimum!!";

async function sign(claims: Record<string, unknown>, extra?: { sub?: string; alg?: "HS256" }) {
  const sub = extra?.sub ?? randomUUID();
  return new SignJWT(claims)
    .setProtectedHeader({ alg: extra?.alg ?? "HS256", typ: "JWT" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

describe("verifySupabaseJwt", () => {
  beforeEach(() => {
    resetSupabaseJwtCache();
  });

  it("accepts a valid HS256 user access token", async () => {
    const sub = randomUUID();
    const token = await sign({ email: "gp@harbor.vc", role: "authenticated", user_metadata: { full_name: "Sarah" } }, { sub });
    const claims = await verifySupabaseJwt(token, { jwtSecret: SECRET });
    expect(claims.sub).toBe(sub);
    expect(claims.email).toBe("gp@harbor.vc");
    expect(claims.userMetadata.full_name).toBe("Sarah");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await sign({ email: "a@b.co", role: "authenticated" });
    await expect(verifySupabaseJwt(token, { jwtSecret: "other-secret-other-secret-other" })).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
  });

  it("rejects anon and service_role tokens", async () => {
    const anon = await sign({ role: "anon", email: "anon@example.com" });
    await expect(verifySupabaseJwt(anon, { jwtSecret: SECRET })).rejects.toBeInstanceOf(CoreError);
    const sr = await sign({ role: "service_role" });
    await expect(verifySupabaseJwt(sr, { jwtSecret: SECRET })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("rejects garbage input", async () => {
    await expect(verifySupabaseJwt("not-a-jwt", { jwtSecret: SECRET })).rejects.toMatchObject({
      code: "unauthorized",
    });
  });

  it("reports auth_not_configured when no verifier is available", async () => {
    const token = await sign({ email: "a@b.co", role: "authenticated" });
    await expect(verifySupabaseJwt(token, {})).rejects.toMatchObject({
      code: "auth_not_configured",
      status: 503,
    });
  });
});

describe("normalizeSupabaseClaims", () => {
  it("requires a UUID subject", () => {
    expect(() => normalizeSupabaseClaims({ sub: "not-uuid", role: "authenticated" })).toThrow(CoreError);
  });
});
