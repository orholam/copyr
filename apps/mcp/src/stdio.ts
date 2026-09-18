import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCore, resolveSession } from "@copyr/core";
import { loadConfig } from "@copyr/config";
import { createCopyrMcpServer } from "./server.js";
import { bindFallbackSession } from "./session.js";

/**
 * stdio entrypoint — for local agents (Claude Desktop, opencode, etc.).
 *
 * Config via env:
 *   COPYR_API_KEY         agent API key (recommended)
 *   COPYR_WORKSPACE_SLUG  dev fallback workspace (default DEV_WORKSPACE_SLUG)
 */
async function main() {
  const core = await createCore({ runWorkers: false });
  const config = loadConfig();
  const session = await resolveSession(core.ctx, {
    apiKey: process.env.COPYR_API_KEY ?? null,
    workspaceSlug: process.env.COPYR_WORKSPACE_SLUG ?? null,
    allowSlug: true,
  });
  bindFallbackSession(session);

  const server = createCopyrMcpServer(core);
  await server.connect(new StdioServerTransport());
  if (config.NODE_ENV !== "production") {
    console.error(`[copyr-mcp] connected as workspace "${session.workspaceSlug}"`);
  }
}

main().catch((err) => {
  console.error("[copyr-mcp] fatal", err);
  process.exit(1);
});
