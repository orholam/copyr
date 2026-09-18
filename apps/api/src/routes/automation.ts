import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createWorkflowSchema,
  updateWorkflowSchema,
  createWebhookSubscriptionSchema,
  updateWebhookSubscriptionSchema,
} from "@copyr/contracts";
import { assertPermission } from "@copyr/core";

const routes: FastifyPluginAsync = async (app) => {
  const core = () => (app as unknown as { core: import("@copyr/core").Core }).core;

  /* ── workflows ─────────────────────────────────────────────────── */
  app.get("/workflows", async (req) => {
    return core().automation.listWorkflows(core().ctx, req.session!);
  });

  app.get("/workflows/:id/runs", async (req) => {
    const q = z
      .object({ id: z.string().uuid(), limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse({ ...(req.params as object), ...(req.query as object) });
    return core().automation.listRuns(core().ctx, req.session!, { workflowId: q.id, limit: q.limit });
  });

  app.post("/workflows", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_automations");
    const input = createWorkflowSchema.parse(req.body);
    return core().automation.createWorkflow(core().ctx, req.session!, input);
  });

  app.patch("/workflows/:id", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_automations");
    const input = updateWorkflowSchema.parse(req.body);
    return core().automation.updateWorkflow(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
      input,
    );
  });

  app.delete("/workflows/:id", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_automations");
    await core().automation.deleteWorkflow(core().ctx, req.session!, (req.params as { id: string }).id);
    return { ok: true };
  });

  /** Dry-run against the most recent real event of this trigger type. */
  app.post("/workflows/:id/test", async (req) => {
    const core_ = core();
    return core_.automation.testWorkflow(core_.ctx, req.session!, (req.params as { id: string }).id);
  });

  app.get("/workflow-runs", async (req) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query ?? {});
    return core().automation.listRuns(core().ctx, req.session!, { limit: q.limit });
  });

  /* ── outbound webhook subscriptions ───────────────────────────── */
  app.get("/webhooks", async (req) => {
    return core().outbound.listWebhookSubscriptions(core().ctx, req.session!);
  });

  app.post("/webhooks", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_webhooks");
    const input = createWebhookSubscriptionSchema.parse(req.body);
    return core().outbound.createWebhookSubscription(core().ctx, req.session!, input);
  });

  app.patch("/webhooks/:id", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_webhooks");
    const input = updateWebhookSubscriptionSchema.parse(req.body);
    return core().outbound.updateWebhookSubscription(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
      input,
    );
  });

  app.delete("/webhooks/:id", async (req) => {
    await assertPermission(core().ctx, req.session!, "manage_webhooks");
    await core().outbound.deleteWebhookSubscription(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
    );
    return { ok: true };
  });

  app.get("/webhooks/:id/deliveries", async (req) => {
    return core().outbound.listDeliveries(
      core().ctx,
      req.session!,
      (req.params as { id: string }).id,
    );
  });

  /* ── presence (ephemeral, over the SSE bus) ───────────────────── */
  app.post("/presence", async (req) => {
    const input = z
      .object({
        entityType: z.enum(["company", "deal"]),
        entityId: z.string().uuid(),
        state: z.enum(["viewing", "leave"]).default("viewing"),
      })
      .parse(req.body);
    let name: string | null = null;
    if (req.session!.actor.userId) {
      const ws = await core().session.getWorkspace(core().ctx, req.session!.workspaceId);
      name = ws.members.find((m) => m.id === req.session!.actor.userId)?.name ?? null;
    }
    await core().ctx.bus.publish({
      workspaceId: req.session!.workspaceId,
      type: "presence",
      entityType: input.entityType,
      entityId: input.entityId,
      actor: req.session!.actor.userId ? "user" : "system",
      userId: req.session!.actor.userId,
      userName: name ?? "Someone",
      state: input.state,
      ts: new Date().toISOString(),
    });
    return { ok: true };
  });

};

export default routes;
