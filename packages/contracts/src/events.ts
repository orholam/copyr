import { z } from "zod";
import { activityActorSchema } from "./common.js";

/**
 * Realtime event envelope pushed over SSE (`GET /api/v1/events`).
 * Types align with the `activities.type` strings so the event stream is a
 * live projection of the audit log.
 */
export const realtimeEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  type: z.string(),
  actor: activityActorSchema,
  summary: z.string(),
  data: z.unknown().nullable(),
  createdAt: z.string(),
});
export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export const EVENT_TYPES = [
  "company.created",
  "company.updated",
  "deal.created",
  "deal.updated",
  "deal.stage_changed",
  "deal.archived",
  "document.created",
  "document.parsed",
  "document.parse_failed",
  "email.received",
  "email.processed",
  "email.needs_review",
  "extraction.completed",
  "extraction.failed",
  "note.added",
  "portfolio_update.created",
  "share_link.created",
  "stage.created",
  "field.created",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
