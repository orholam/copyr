import type { AppConfig } from "@copyr/config";

/**
 * SSL setting for node-postgres / pg-boss.
 *
 * Supabase requires TLS. Local docker-compose Postgres does not.
 * `rejectUnauthorized: false` is required against Supabase's pooler cert chain
 * from typical PaaS runtimes.
 */
export function pgSsl(
  url: string,
  mode: AppConfig["DATABASE_SSL"] = "auto",
): { rejectUnauthorized: boolean } | undefined {
  if (mode === "disable") return undefined;
  if (mode === "require") return { rejectUnauthorized: false };
  if (
    /[?&]sslmode=(require|verify-full|verify-ca)/i.test(url) ||
    /\.supabase\.co([:/?]|$)/i.test(url) ||
    /pooler\.supabase\.com([:/?]|$)/i.test(url)
  ) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

/** Query pool URL (transaction pooler) vs session/direct URL used by pg-boss. */
export function queryDatabaseUrl(cfg: Pick<AppConfig, "DATABASE_URL" | "DATABASE_POOL_URL">): string {
  return cfg.DATABASE_POOL_URL ?? cfg.DATABASE_URL;
}
