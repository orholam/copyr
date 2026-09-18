import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
import { loadConfig } from "@copyr/config";
import { CoreError } from "../context.js";
import { verifySupabaseAccessToken } from "./supabase-jwt.js";

const SECRET = "test-jwt-secret-for-copyr-auth-hs256";
const SUPABASE_URL = "https://copyr-test.supabase.co";
const ISSUER = `${SUPABASE_URL}/auth/v1`;

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    SUPABASE_URL,
    SUPABASE_JWT_SECRET: SECRET,
  });
}

async function signToken(
  claims: Record<string, unknown>,
  opts: { sub?: string; exp?: string | number | Date; aud?: string; role?: string } = {},
): Promise<string> {
  return new SignJWT({
    email: "gp@example.vc",
    role: opts.role ?? "authenticated",
    ...claims,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(opts.sub ?? "11111111-1111-4111-8111-111111111111")
    .setIssuer(ISSUER)
    .setAudience(opts.aud ?? "authenticated")
    .setExpirationTime(opts.exp ?? "1h")
    .sign(new TextEncoder().encode(SECRET));
}

describe("verifySupabaseAccessToken", () => {
  it("accepts a valid HS256 access token and returns the subject + email", async () => {
    const token = await signToken({
      email: "Sarah@Harbor.vc",
      user_metadata: { full_name: "Sarah Kim", firm_name: "Harbor Ventures" },
    });
    const user = await verifySupabaseAccessToken(testConfig(), token);
    expect(user.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(user.email).toBe("sarah@harbor.vc");
    expect(user.name).toBe("Sarah Kim");
    expect(user.firmName).toBe("Harbor Ventures");
  });

  it("rejects the anon role so the publishable/anon JWT cannot impersonate a user", async () => {
    const token = await signToken({}, { role: "anon" });
    const err = await verifySupabaseAccessToken(testConfig(), token).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CoreError);
    expect((err as CoreError).status).toBe(401);
    expect((err as CoreError).code).toBe("unauthorized");
  });

  it("rejects expired tokens", async () => {
    const token = await signToken({}, { exp: new Date(Date.now() - 120_000) });
    await expect(verifySupabaseAccessToken(testConfig(), token)).rejects.toMatchObject({
      status: 401,
      code: "unauthorized",
    });
  });

  it("rejects a malformed token", async () => {
    await expect(verifySupabaseAccessToken(testConfig(), "not-a-jwt")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await new SignJWT({ email: "x@y.z", role: "authenticated" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("11111111-1111-4111-8111-111111111111")
      .setIssuer(ISSUER)
      .setAudience("authenticated")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret-value-not-the-real-one"));
    await expect(verifySupabaseAccessToken(testConfig(), token)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("fails closed when a bearer token is sent but auth is not configured", async () => {
    const cfg = loadConfig({ NODE_ENV: "test", SUPABASE_URL: "", SUPABASE_JWT_SECRET: "", SUPABASE_ANON_KEY: "" });
    await expect(verifySupabaseAccessToken(cfg, "aaa.bbb.ccc")).rejects.toMatchObject({
      status: 401,
    });
  });
});
