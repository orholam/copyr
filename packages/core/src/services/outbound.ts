import { createHmac, randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { webhookSubscriptions, webhookDeliveries } from "@copyr/db/schema.js";
import type {
  RealtimeEvent,
  WebhookSubscriptionDto,
  CreateWebhookSubscriptionInput,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { toIso } from "../mappers.js";

const MAX_ATTEMPTS = 5;
const DELIVER_TIMEOUT_MS = 10_000;

/* ── CRUD ──────────────────────────────────────────────────────────── */

function mapSub(
  row: typeof webhookSubscriptions.$inferSelect,
  secret?: string,
): WebhookSubscriptionDto {
  return {
    id: row.id,
    url: row.url,
    events: row.events ?? ["*"],
    description: row.description,
    isActive: row.isActive,
    failureCount: row.failureCount,
    lastDeliveryAt: toIso(row.lastDeliveryAt),
    lastStatus: row.lastStatus,
    createdAt: toIso(row.createdAt)!,
    ...(secret ? { secret } : {}),
  };
}

export async function listWebhookSubscriptions(
  ctx: CoreContext,
  session: Session,
): Promise<WebhookSubscriptionDto[]> {
  const rows = await ctx.db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.workspaceId, session.workspaceId))
    .orderBy(desc(webhookSubscriptions.createdAt));
  return rows.map((r) => mapSub(r));
}

export async function createWebhookSubscription(
  ctx: CoreContext,
  session: Session,
  input: CreateWebhookSubscriptionInput,
): Promise<WebhookSubscriptionDto> {
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const [row] = await ctx.db
    .insert(webhookSubscriptions)
    .values({
      workspaceId: session.workspaceId,
      url: input.url,
      events: input.events,
      description: input.description ?? null,
      secret,
      createdByUserId: session.actor.userId,
    })
    .returning();
  // secret is returned exactly once
  return mapSub(row!, secret);
}

export async function updateWebhookSubscription(
  ctx: CoreContext,
  session: Session,
  subscriptionId: string,
  patch: Partial<CreateWebhookSubscriptionInput> & { isActive?: boolean },
): Promise<WebhookSubscriptionDto> {
  const [row] = await ctx.db
    .update(webhookSubscriptions)
    .set({
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.events !== undefined ? { events: patch.events } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
    })
    .where(
      and(
        eq(webhookSubscriptions.id, subscriptionId),
        eq(webhookSubscriptions.workspaceId, session.workspaceId),
      ),
    )
    .returning();
  if (!row) throw new CoreError("webhook subscription not found", { status: 404 });
  return mapSub(row);
}

export async function deleteWebhookSubscription(
  ctx: CoreContext,
  session: Session,
  subscriptionId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.id, subscriptionId),
        eq(webhookSubscriptions.workspaceId, session.workspaceId),
      ),
    )
    .returning({ id: webhookSubscriptions.id });
  if (!deleted.length) throw new CoreError("webhook subscription not found", { status: 404 });
}

export async function listDeliveries(
  ctx: CoreContext,
  session: Session,
  subscriptionId: string,
) {
  const rows = await ctx.db
    .select()
    .from(webhookDeliveries)
    .innerJoin(
      webhookSubscriptions,
      eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id),
    )
    .where(
      and(
        eq(webhookDeliveries.subscriptionId, subscriptionId),
        eq(webhookSubscriptions.workspaceId, session.workspaceId),
      ),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(100);
  return rows.map(({ webhook_deliveries: d }) => ({
    id: d.id,
    subscriptionId: d.subscriptionId,
    event: d.event,
    status: d.status,
    responseStatus: d.responseStatus,
    attempts: d.attempts,
    error: d.error,
    createdAt: toIso(d.createdAt)!,
    deliveredAt: toIso(d.deliveredAt),
  }));
}

/* ── dispatch & delivery ───────────────────────────────────────────── */

/** Fan an emitted event out to every matching active subscription. */
export async function dispatchEventToWebhooks(
  ctx: CoreContext,
  event: RealtimeEvent,
): Promise<number> {
  const subs = await ctx.db
    .select()
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.workspaceId, event.workspaceId),
        eq(webhookSubscriptions.isActive, true),
      ),
    );
  const matching = subs.filter(
    (s) => !s.events?.length || s.events.includes("*") || s.events.includes(event.type),
  );

  for (const sub of matching) {
    const payload = {
      id: event.id,
      event: event.type,
      workspaceId: event.workspaceId,
      entityType: event.entityType,
      entityId: event.entityId,
      // denormalised linkage: deal → company without an extra fetch
      companyId: (event as { companyId?: string | null }).companyId ?? null,
      dealId: (event as { dealId?: string | null }).dealId ?? null,
      actor: event.actor,
      summary: event.summary,
      data: event.data,
      occurredAt: event.createdAt,
    };
    const [delivery] = await ctx.db
      .insert(webhookDeliveries)
      .values({
        workspaceId: event.workspaceId,
        subscriptionId: sub.id,
        event: event.type,
        payload: payload as unknown as Record<string, unknown>,
      })
      .returning();
    await ctx.enqueue("webhook-deliver", { deliveryId: delivery!.id });
  }
  return matching.length;
}

export function signPayload(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Deliver one webhook (called by the `webhook-deliver` job). */
export async function deliverWebhook(ctx: CoreContext, deliveryId: string): Promise<void> {
  const [row] = await ctx.db
    .select({ delivery: webhookDeliveries, sub: webhookSubscriptions })
    .from(webhookDeliveries)
    .innerJoin(
      webhookSubscriptions,
      eq(webhookDeliveries.subscriptionId, webhookSubscriptions.id),
    )
    .where(eq(webhookDeliveries.id, deliveryId));
  if (!row) return;
  const { delivery, sub } = row;
  if (!sub.isActive) {
    await ctx.db
      .update(webhookDeliveries)
      .set({ status: "failed", error: "subscription deactivated" })
      .where(eq(webhookDeliveries.id, deliveryId));
    return;
  }

  const body = JSON.stringify(delivery.payload);
  let responseStatus: number | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "VentureLabs-Webhooks/1.0",
        "x-copyr-event": delivery.event,
        "x-copyr-delivery": delivery.id,
        "x-copyr-signature": signPayload(sub.secret, body),
      },
      body,
      signal: AbortSignal.timeout(DELIVER_TIMEOUT_MS),
    });
    responseStatus = res.status;
    if (!res.ok) error = `endpoint returned ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const attempts = (delivery.attempts ?? 0) + 1;
  const delivered = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;
  const exhausted = !delivered && attempts >= MAX_ATTEMPTS;

  await ctx.db
    .update(webhookDeliveries)
    .set({
      status: delivered ? "delivered" : exhausted ? "failed" : "pending",
      responseStatus,
      attempts,
      error: delivered ? null : `${error ?? "unknown"}${exhausted ? ` (gave up after ${MAX_ATTEMPTS} attempts)` : ""}`,
      deliveredAt: delivered ? new Date() : null,
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  await ctx.db
    .update(webhookSubscriptions)
    .set({
      lastDeliveryAt: new Date(),
      lastStatus: responseStatus,
      failureCount: delivered ? 0 : sql`${webhookSubscriptions.failureCount} + 1`,
    })
    .where(eq(webhookSubscriptions.id, sub.id));

  // Exponential backoff: 30s, 60s, 120s, 240s between attempts.
  if (!delivered && !exhausted) {
    const backoffSeconds = Math.min(30 * 2 ** (attempts - 1), 600);
    await ctx.enqueue("webhook-deliver", { deliveryId }, { startAfter: backoffSeconds });
  }
}
