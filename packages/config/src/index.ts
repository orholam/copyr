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

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().default(4100),
  PUBLIC_URL: z.string().url().default("http://localhost:4100"),
  WEB_URL: z.string().url().default("http://localhost:5173"),

  DEV_WORKSPACE_SLUG: z.string().default("harbor-ventures"),

  DATABASE_URL: z
    .string()
    .startsWith("postgres")
    .default("postgres://copyr:copyr@localhost:5433/copyr"),

  STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
  STORAGE_REGION: z.string().default("us-east-1"),
  STORAGE_BUCKET: z.string().default("copyr-local"),
  STORAGE_ACCESS_KEY_ID: z.string().default("copyr-dev"),
  STORAGE_SECRET_ACCESS_KEY: z.string().default("copyr-dev-secret"),
  STORAGE_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  AI_CREDITS_MONTHLY_GRANT: z.coerce.number().int().default(500),

  INBOUND_WEBHOOK_SECRET: z.string().default("dev-inbound-secret"),

  JOB_CONCURRENCY: z.coerce.number().int().default(4),
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | undefined;

export function loadConfig(overrides: Partial<Record<string, string>> = {}): AppConfig {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const parsed = schema.parse({ ...process.env, ...overrides });
  if (Object.keys(overrides).length === 0) cached = parsed;
  return parsed;
}

export function resetConfigCache(): void {
  cached = undefined;
}
