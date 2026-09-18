import { Client } from "../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";

const transport = new StdioClientTransport({
  command: "pnpm",
  args: ["--filter", "@copyr/mcp", "run", "stdio"],
  env: { ...process.env, COPYR_WORKSPACE_SLUG: "harbor-ventures" },
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.length);

const ws = await client.callTool({ name: "get_workspace_info", arguments: {} });
const info = JSON.parse(ws.content[0].text);
console.log("workspace:", info.name, "| credits:", info.aiCreditsBalance);

const deals = await client.callTool({
  name: "list_deals",
  arguments: { limit: 3 },
});
const parsed = JSON.parse(deals.content[0].text);
console.log("deals fetched:", parsed.items.length, "| first:", parsed.items[0]?.company.name);

const analytics = await client.callTool({ name: "analytics_overview", arguments: {} });
const a = JSON.parse(analytics.content[0].text);
console.log("analytics: active =", a.activeDeals, "| pipeline $ =", a.totalPipelineUsd);

await client.close();
console.log("MCP STDIO SMOKE OK");
process.exit(0);
