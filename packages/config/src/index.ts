import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Minimal .env loader: walks up from cwd until it finds a `.env` file
 * (repo root in dev). Existing process.env always wins — real env vars
 * and explicit overrides take precedence over file values.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      for (const rawLine of readFileSync(candidate, "utf8").split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq <= 0) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

loadDotEnv();

/** Treat blank env values as unset so production can clear a default. */
const emptyToUndef = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

/** Env-friendly boolean: "false" / "0" are false (unlike Boolean("false")). */
const envBoolean = (fallback: boolean) =>
  z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      if (["false", "0", "no", "off"].includes(s)) return false;
      if (["true", "1", "yes", "on"].includes(s)) return true;
    }
    return v;
  }, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4100),
  PUBLIC_URL: z.string().url().default("http://localhost:4100"),
  WEB_URL: z.string().url().default("http://localhost:5173"),

  DEV_WORKSPACE_SLUG: z.string().default("harbor-ventures"),

  /**
   * When true, `X-Workspace-Slug` / `DEV_WORKSPACE_SLUG` can authenticate a
   * request without a Bearer token or API key. Defaults off in production
   * unless the operator sets this explicitly.
   */
  ALLOW_DEV_WORKSPACE_AUTH: envBoolean(true),

  /** venlabs-demo: https://cdsngnauduhiaidzncie.supabase.co */
  SUPABASE_URL: z.preprocess(emptyToUndef, z.string().url().optional()),
  /** Legacy anon JWT or sb_publishable_… key. Server uses this for Auth API fallback. */
  SUPABASE_ANON_KEY: z.preprocess(emptyToUndef, z.string().min(1).optional()),
  /**
   * Shared secret for HS256 (legacy) access tokens. Prefer JWKS (ES256) via
   * SUPABASE_URL; set this only if the project still signs with HS256.
   */
  SUPABASE_JWT_SECRET: z.preprocess(emptyToUndef, z.string().min(1).optional()),

  /** Session-mode or direct Postgres URL. Used for migrations and pg-boss (LISTEN/NOTIFY). */
  DATABASE_URL: z
    .string()
    .startsWith("postgres")
    .default("postgres://copyr:copyr@localhost:5433/copyr"),
  /**
   * Optional transaction-mode pooler URL for the app query pool (Supabase port 6543).
   * Leave unset locally. Never point pg-boss at this URL.
   */
  DATABASE_POOL_URL: z.preprocess(emptyToUndef, z.string().startsWith("postgres").optional()),
  /** `auto` enables SSL for Supabase hosts / sslmode=require. */
  DATABASE_SSL: z.enum(["auto", "require", "disable"]).default("auto"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /**
   * S3-compatible endpoint. MinIO locally; Supabase Storage S3 API in prod:
   * `https://<project-ref>.storage.supabase.co/storage/v1/s3`.
   * Empty string + native AWS S3: omit and set STORAGE_FORCE_PATH_STYLE=false.
   */
  STORAGE_ENDPOINT: z.preprocess(emptyToUndef, z.string().url().optional()),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: z.string().default("copyr-local"),
  STORAGE_ACCESS_KEY_ID: z.string().default("copyr-dev"),
  STORAGE_SECRET_ACCESS_KEY: z.string().default("copyr-dev-secret"),
  STORAGE_FORCE_PATH_STYLE: envBoolean(true),

  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_CREDITS_MONTHLY_GRANT: z.coerce.number().int().default(500),

  INBOUND_WEBHOOK_SECRET: z.string().default("dev-inbound-secret"),

  JOB_CONCURRENCY: z.coerce.number().int().default(4),

  /** Comma-separated extra browser origins allowed by the API CORS policy. */
  CORS_ORIGINS: z.string().default(""),
  /** Allow `https://*.vercel.app` preview deployments to call the API. */
  CORS_ALLOW_VERCEL_PREVIEWS: envBoolean(false),

  /** Run drizzle migrations on API boot (useful as a Render release/start hook). */
  AUTO_MIGRATE: envBoolean(false),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = schema.parse({ ...process.env, ...overrides });
  if (!parsed.STORAGE_ENDPOINT && parsed.NODE_ENV !== "production") {
    parsed.STORAGE_ENDPOINT = "http://localhost:9000";
  }
  const explicitDevAuth =
    Object.prototype.hasOwnProperty.call(overrides, "ALLOW_DEV_WORKSPACE_AUTH") ||
    Object.prototype.hasOwnProperty.call(process.env, "ALLOW_DEV_WORKSPACE_AUTH");
  if (!explicitDevAuth && parsed.NODE_ENV === "production") {
    parsed.ALLOW_DEV_WORKSPACE_AUTH = false;
  }
  if (Object.keys(overrides).length === 0) cached = parsed;
  return parsed;
}

export function resetConfigCache(): void {
  cached = undefined;
}

export function extraCorsOrigins(cfg: AppConfig): string[] {
  return cfg.CORS_ORIGINS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAllowedCorsOrigin(origin: string, cfg: AppConfig): boolean {
  const allowed = new Set([
    cfg.WEB_URL,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...extraCorsOrigins(cfg),
  ]);
  if (allowed.has(origin)) return true;
  if (cfg.CORS_ALLOW_VERCEL_PREVIEWS && /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin)) {
    return true;
  }
  return false;
}
