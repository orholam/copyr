import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { memberships, users as usersTable, workspaces } from "@copyr/db/schema.js";
import {
  assertPermission,
  memberPermissions,
  resolveSession,
  revokeApiKey,
} from "./services/workspace.js";
import { CoreError } from "./context.js";
import type { Session } from "./context.js";
import { cleanupWorkspace, getTestDb, seedWorkspace, type WsFixture } from "./test-db.js";

const JWT_SECRET = "workspace-service-test-jwt-secret!!";

const db = await getTestDb();

describe.skipIf(db === null)("workspace service (integration)", () => {
  let fx: WsFixture;

  beforeAll(async () => {
    fx = await seedWorkspace(db!);
  });

  afterAll(async () => {
    await cleanupWorkspace(fx);
  });

  describe("resolveSession", () => {
    it("resolves a workspace by slug with the owner as default actor", async () => {
      const session = await resolveSession(fx.ctx, { workspaceSlug: fx.workspaceSlug });
      expect(session.workspaceId).toBe(fx.workspaceId);
      expect(session.workspaceSlug).toBe(fx.workspaceSlug);
      expect(session.actor).toEqual({ userId: fx.userIds.owner, source: "api" });
    });

    it("rejects unknown slugs with a 404", async () => {
      const err = await resolveSession(fx.ctx, { workspaceSlug: "does-not-exist" }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CoreError);
      const coreErr = err as CoreError;
      expect(coreErr.status).toBe(404);
      expect(coreErr.code).toBe("no_workspace");
    });

    it("rejects slug-only auth when ALLOW_DEV_WORKSPACE_AUTH is off", async () => {
      const previous = fx.ctx.config.ALLOW_DEV_WORKSPACE_AUTH;
      fx.ctx.config.ALLOW_DEV_WORKSPACE_AUTH = false;
      try {
        const err = await resolveSession(fx.ctx, { workspaceSlug: fx.workspaceSlug }).catch(
          (e: unknown) => e,
        );
        expect(err).toBeInstanceOf(CoreError);
        expect((err as CoreError).code).toBe("unauthorized");
        expect((err as CoreError).status).toBe(401);
      } finally {
        fx.ctx.config.ALLOW_DEV_WORKSPACE_AUTH = previous;
      }
    });
  });

  describe("api key sessions", () => {
    const agentSession = (): Session => ({
      workspaceId: fx.workspaceId,
      actor: { userId: null, source: "agent" },
    });

    it("authenticates a valid key as an agent actor", async () => {
      const session = await resolveSession(fx.ctx, { apiKey: fx.apiKeySecret });
      expect(session.workspaceId).toBe(fx.workspaceId);
      expect(session.actor.source).toBe("agent");
      expect(session.actor.userId).toBeNull();
    });

    it("rejects garbage keys with a 401", async () => {
      const err = await resolveSession(fx.ctx, { apiKey: "ck_totally-invalid-key" }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CoreError);
      expect((err as CoreError).status).toBe(401);
      expect((err as CoreError).code).toBe("unauthorized");
    });

    it("rejects revoked keys even if the secret matches", async () => {
      await revokeApiKey(fx.ctx, agentSession(), fx.apiKeyId);
      const err = await resolveSession(fx.ctx, { apiKey: fx.apiKeySecret }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CoreError);
      expect((err as CoreError).code).toBe("unauthorized");
    });
  });

  describe("RBAC permission sets", () => {
    const sessionFor = (userId: string | null): Session => ({
      workspaceId: fx.workspaceId,
      actor: { userId, source: "api" },
    });

    it("owners hold every permission", async () => {
      const perms = await memberPermissions(fx.ctx, sessionFor(fx.userIds.owner));
      for (const p of [
        "manage_pipeline",
        "manage_fields",
        "manage_automations",
        "manage_webhooks",
        "manage_team",
        "manage_billing",
        "export_data",
      ]) {
        expect(perms.has(p as never)).toBe(true);
      }
    });

    it("admins hold operational permissions but not team/billing", async () => {
      const perms = await memberPermissions(fx.ctx, sessionFor(fx.userIds.admin));
      expect(perms.has("manage_pipeline")).toBe(true);
      expect(perms.has("export_data")).toBe(true);
      expect(perms.has("manage_team")).toBe(false);
      expect(perms.has("manage_billing")).toBe(false);
    });

    it("plain members can only export data", async () => {
      const perms = await memberPermissions(fx.ctx, sessionFor(fx.userIds.member));
      expect([...perms]).toEqual(["export_data"]);
    });

    it("extra grants extend the role defaults", async () => {
      await fx.db
        .update(memberships)
        .set({ permissions: ["manage_fields"] })
        .where(eq(memberships.userId, fx.userIds.member));
      try {
        const perms = await memberPermissions(fx.ctx, sessionFor(fx.userIds.member));
        expect(perms.has("export_data")).toBe(true);
        expect(perms.has("manage_fields")).toBe(true);
        expect(perms.has("manage_billing")).toBe(false);
      } finally {
        await fx.db
          .update(memberships)
          .set({ permissions: [] })
          .where(eq(memberships.userId, fx.userIds.member));
      }
    });

    it("API-key callers operate with workspace-level (owner) authority", async () => {
      const perms = await memberPermissions(fx.ctx, sessionFor(null));
      expect(perms.has("manage_billing")).toBe(true);
    });

    it("assertPermission throws 403 forbidden when lacking", async () => {
      await expect(
        assertPermission(fx.ctx, sessionFor(fx.userIds.member), "manage_fields"),
      ).rejects.toMatchObject({ code: "forbidden", status: 403 });
      await expect(
        assertPermission(fx.ctx, sessionFor(fx.userIds.admin), "export_data"),
      ).resolves.toBeUndefined();
    });

    it("unknown membership falls back to empty member permissions", async () => {
      const [outsider] = await fx.db
        .insert(usersTable)
        .values({
          email: `outsider-${fx.workspaceSlug}@test.copyr.dev`,
          name: "Outsider",
        })
        .returning();
      try {
        const perms = await memberPermissions(fx.ctx, sessionFor(outsider.id));
        expect([...perms]).toEqual([]);
      } finally {
        await fx.db.delete(usersTable).where(eq(usersTable.id, outsider.id));
      }
    });
  });

  describe("supabase JWT sessions", () => {
    async function tokenFor(opts: {
      sub?: string;
      email: string;
      name?: string;
      firm?: string;
    }): Promise<{ token: string; sub: string }> {
      const sub = opts.sub ?? randomUUID();
      const token = await new SignJWT({
        email: opts.email,
        role: "authenticated",
        user_metadata: {
          ...(opts.name ? { full_name: opts.name } : {}),
          ...(opts.firm ? { firm_name: opts.firm } : {}),
        },
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(sub)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(new TextEncoder().encode(JWT_SECRET));
      return { token, sub };
    }

    beforeAll(() => {
      fx.ctx.config.SUPABASE_JWT_SECRET = JWT_SECRET;
      fx.ctx.config.ALLOW_DEV_WORKSPACE_AUTH = false;
    });

    it("maps a JWT to an existing membership and ignores a non-member slug hint", async () => {
      const owner = (
        await fx.db.select().from(usersTable).where(eq(usersTable.id, fx.userIds.owner))
      )[0]!;
      const { token } = await tokenFor({ sub: owner.id, email: owner.email });
      const session = await resolveSession(fx.ctx, {
        accessToken: token,
        workspaceSlug: "not-a-workspace",
      });
      expect(session.workspaceId).toBe(fx.workspaceId);
      expect(session.actor.userId).toBe(owner.id);
    });

    it("provisions a workspace + owner membership on first signup", async () => {
      const email = `new-${randomUUID().slice(0, 8)}@copyr.dev`;
      const { token, sub } = await tokenFor({
        email,
        name: "Ada Lovelace",
        firm: "Analytical Engines",
      });
      const session = await resolveSession(fx.ctx, { accessToken: token });
      expect(session.actor.userId).toBe(sub);
      expect(session.workspaceSlug).toMatch(/^analytical-engines/);
      const [member] = await fx.db
        .select()
        .from(memberships)
        .where(eq(memberships.userId, sub));
      expect(member?.role).toBe("owner");
      const again = await resolveSession(fx.ctx, { accessToken: token });
      expect(again.workspaceId).toBe(session.workspaceId);
      await fx.db.delete(workspaces).where(eq(workspaces.id, session.workspaceId));
      await fx.db.delete(usersTable).where(eq(usersTable.id, sub));
    });

    it("rejects a forged token", async () => {
      const { token } = await tokenFor({ email: "forge@copyr.dev" });
      const previous = fx.ctx.config.SUPABASE_JWT_SECRET;
      fx.ctx.config.SUPABASE_JWT_SECRET = "definitely-not-the-signing-secret!!";
      try {
        await expect(resolveSession(fx.ctx, { accessToken: token })).rejects.toMatchObject({
          code: "unauthorized",
          status: 401,
        });
      } finally {
        fx.ctx.config.SUPABASE_JWT_SECRET = previous;
      }
    });
  });
});
