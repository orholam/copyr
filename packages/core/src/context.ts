import type { Database } from "@copyr/db";
import type { ObjectStore } from "@copyr/storage";
import type { AiProvider } from "@copyr/ai";
import type { AppConfig } from "@copyr/config";
import PgBoss from "pg-boss";
import type pg from "pg";

import type { Actor } from "@copyr/contracts";
import { RealtimeBus } from "./realtime.js";

export interface CoreDeps {
  db: Database;
  storage: ObjectStore;
  ai: AiProvider;
  config: AppConfig;
  /** provided by apps that run workers; enqueue still works without it */
  boss?: PgBoss;
}

export interface CoreContext extends CoreDeps {
  bus: RealtimeBus;
  enqueue(
    queue: string,
    data: unknown,
    opts?: { startAfter?: number | Date },
  ): Promise<string | undefined>;
}

export function createCoreContext(deps: CoreDeps): CoreContext {
  const ctx: CoreContext = {
    ...deps,
    bus: new RealtimeBus(deps.config.DATABASE_URL),
    async enqueue(queue, data, opts) {
      if (!deps.boss) return undefined;
      const jobId =
        opts?.startAfter !== undefined
          ? await deps.boss.send(queue, data as object, { startAfter: opts.startAfter })
          : await deps.boss.send(queue, data as object);
      return jobId ?? undefined;
    },
  };
  return ctx;
}

/** Resolved caller for every service call. */
export interface Session {
  workspaceId: string;
  actor: Actor;
}

export class CoreError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(message: string, opts: { code?: string; status?: number; details?: unknown } = {}) {
    super(message);
    this.code = opts.code ?? "core_error";
    this.status = opts.status ?? 400;
    this.details = opts.details;
  }
}

export type { Database, pg };
