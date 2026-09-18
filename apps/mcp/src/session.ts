import { AsyncLocalStorage } from "node:async_hooks";
import type { Session } from "@copyr/core";

/**
 * Per-request tenant isolation. Every MCP request (HTTP or stdio) runs inside
 * an AsyncLocalStorage scope carrying its workspace Session; tool handlers
 * read the session implicitly, so no tool can ever cross tenants by accident
 * and none of them need session plumbing.
 */
const storage = new AsyncLocalStorage<Session>();

export function runWithSession<T>(session: Session, fn: () => T): T {
  return storage.run(session, fn);
}

/** Bind a fallback used when no request scope exists (stdio servers). */
let fallback: Session | null = null;

export function bindFallbackSession(session: Session): void {
  fallback = session;
}

export class MissingSessionError extends Error {
  constructor() {
    super("no workspace session bound to this MCP request");
    this.name = "MissingSessionError";
  }
}

export function requireSession(): Session {
  const session = storage.getStore() ?? fallback;
  if (!session) throw new MissingSessionError();
  return session;
}
