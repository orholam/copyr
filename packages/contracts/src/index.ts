export * from "./common.js";
export * from "./entities.js";
export * from "./ingestion.js";
export * from "./events.js";
export * from "./sharing.js";
export * from "./search.js";
export * from "./automation.js";
export * from "./platform.js";

import { z } from "zod";
import { paginationSchema } from "./common.js";

/** Standard API error envelope. */
export const apiErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Standard list envelope. */
export const listEnvelope = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int() }).extend(paginationSchema.shape);
