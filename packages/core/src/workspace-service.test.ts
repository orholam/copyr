import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { memberships, users as usersTable } from "@copyr/db/schema.js";
import {
  assertPermission,
  memberPermissions,
  resolveSession,
  revokeApiKey,
} from "./services/workspace.js";
import { CoreError } from "./context.js";
import type { Session } from "./context.js";
import { cleanupWorkspace, getTestDb, seedWorkspace, type WsFixture } from "./test-db.js";

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
});
