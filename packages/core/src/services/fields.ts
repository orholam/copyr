import { and, eq, asc, inArray, sql } from "drizzle-orm";
import { customFields } from "@copyr/db/schema.js";
import type {
  CreateCustomFieldInput,
  CustomFieldDto,
  FieldValuePrimitive,
} from "@copyr/contracts";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { mapCustomField } from "../mappers.js";
import { logActivity } from "../activity.js";
import { fieldValues } from "@copyr/db/schema.js";

export async function listCustomFields(
  ctx: CoreContext,
  session: Session,
): Promise<CustomFieldDto[]> {
  const rows = await ctx.db
    .select()
    .from(customFields)
    .where(eq(customFields.workspaceId, session.workspaceId))
    .orderBy(asc(customFields.target), asc(customFields.position));
  return rows.map(mapCustomField);
}

export async function createCustomField(
  ctx: CoreContext,
  session: Session,
  input: CreateCustomFieldInput,
): Promise<CustomFieldDto> {
  const existing = await ctx.db
    .select({ id: customFields.id })
    .from(customFields)
    .where(
      and(
        eq(customFields.workspaceId, session.workspaceId),
        eq(customFields.target, input.target),
        eq(customFields.key, input.key),
      ),
    );
  if (existing.length) {
    throw new CoreError(`field key "${input.key}" already exists for ${input.target}`, {
      code: "field_exists",
      status: 409,
    });
  }

  const [{ count }] = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(customFields)
    .where(
      and(
        eq(customFields.workspaceId, session.workspaceId),
        eq(customFields.target, input.target),
      ),
    );

  const [row] = await ctx.db
    .insert(customFields)
    .values({
      workspaceId: session.workspaceId,
      target: input.target,
      key: input.key,
      label: input.label,
      type: input.type,
      options: input.options ?? null,
      isRequired: input.isRequired,
      showInTable: input.showInTable,
      aiExtractable: input.aiExtractable,
      position: Number(count),
    })
    .returning();

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "custom_field",
    entityId: row.id,
    type: "field.created",
    summary: `Created ${input.target} field "${input.label}"`,
    actor: session.actor.userId ? "user" : "system",
    actorUserId: session.actor.userId,
  });
  return mapCustomField(row);
}

export async function updateCustomField(
  ctx: CoreContext,
  session: Session,
  fieldId: string,
  patch: Partial<CreateCustomFieldInput>,
): Promise<CustomFieldDto> {
  const [row] = await ctx.db
    .update(customFields)
    .set(patch)
    .where(and(eq(customFields.id, fieldId), eq(customFields.workspaceId, session.workspaceId)))
    .returning();
  if (!row) throw new CoreError("field not found", { status: 404 });
  return mapCustomField(row);
}

export async function deleteCustomField(
  ctx: CoreContext,
  session: Session,
  fieldId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(customFields)
    .where(and(eq(customFields.id, fieldId), eq(customFields.workspaceId, session.workspaceId)))
    .returning({ id: customFields.id });
  if (!deleted.length) throw new CoreError("field not found", { status: 404 });
}

/**
 * Validate + persist a batch of field values for an entity.
 * Values are keyed by field KEY; unknown keys throw. Runs in tx.
 */
export async function setFieldValues(
  ctx: CoreContext,
  exec: Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0],
  session: Session,
  entityType: "deal" | "company",
  entityId: string,
  values: Record<string, FieldValuePrimitive | null>,
  opts: { confidence?: number } = {},
): Promise<void> {
  const keys = Object.keys(values);
  if (!keys.length) return;

  const defs = await exec
    .select()
    .from(customFields)
    .where(eq(customFields.workspaceId, session.workspaceId));
  const byKey = new Map(defs.filter((d) => d.target === entityType).map((d) => [d.key, d]));

  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) {
      throw new CoreError(`unknown ${entityType} field "${key}"`, {
        code: "unknown_field",
        status: 422,
      });
    }
    let value = values[key];
    if (
      value !== null &&
      def.type === "select" &&
      def.options?.length &&
      !def.options.includes(String(value))
    ) {
      throw new CoreError(`"${value}" is not an option of select field "${key}"`, {
        code: "invalid_option",
        status: 422,
        details: { options: def.options },
      });
    }
    if (def.type === "number" || def.type === "currency") {
      if (value !== null && typeof value === "string") {
        const n = Number(value);
        value = Number.isNaN(n) ? value : n;
      }
    }
    if (value !== null && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && !Array.isArray(value)) {
      throw new CoreError(`invalid value type for field "${key}"`, { status: 422 });
    }

    await exec
      .insert(fieldValues)
      .values({
        workspaceId: session.workspaceId,
        fieldId: def.id,
        entityType,
        entityId,
        value: value as never,
        confidence: opts.confidence != null ? String(opts.confidence) : null,
        setByActor: session.actor.source === "agent" || session.actor.source === "email" ? "ai" : "user",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [fieldValues.fieldId, fieldValues.entityType, fieldValues.entityId],
        set: {
          value: value as never,
          ...(opts.confidence != null ? { confidence: String(opts.confidence) } : {}),
          setByActor: session.actor.source === "agent" || session.actor.source === "email" ? "ai" : "user",
          updatedAt: new Date(),
        },
      });
  }
}

/** Load resolved field values (keyed) for many entities of one type. */
export async function loadFieldMaps(
  ctx: CoreContext,
  workspaceId: string,
  entityType: "deal" | "company",
  entityIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!entityIds.length) return out;
  const rows = await ctx.db
    .select({
      entityId: fieldValues.entityId,
      key: customFields.key,
      value: fieldValues.value,
    })
    .from(fieldValues)
    .innerJoin(customFields, eq(fieldValues.fieldId, customFields.id))
    .where(
      and(
        eq(fieldValues.workspaceId, workspaceId),
        eq(fieldValues.entityType, entityType),
        inArray(fieldValues.entityId, entityIds),
      ),
    );
  for (const row of rows) {
    const bucket = out.get(row.entityId) ?? {};
    if (row.value !== null && row.value !== undefined) bucket[row.key!] = row.value;
    out.set(row.entityId, bucket);
  }
  return out;
}
