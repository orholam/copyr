import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Core, Session } from "@copyr/core";

import { createCopyrMcpServer } from "./server.js";
import { runWithSession } from "./session.js";

/**
 * Tool host backed by THE main MCP server, connected in-process.
 *
 * The Assistant doesn't get a parallel toolset — it speaks to the exact same
 * MCP surface external agents use (every current and future tool, one write
 * path). Transport is an in-memory linked pair: no network hop, and every
 * call runs inside the caller's session so tenant isolation is preserved.
 */
export interface AssistantToolHost {
  listTools(): Promise<Array<{ name: string; description: string }>>;
  call(name: string, args: Record<string, unknown>, session: Session): Promise<unknown>;
}

interface McpTextContent {
  type: string;
  text?: string;
}

export async function createAssistantMcpBridge(core: Core): Promise<AssistantToolHost> {
  const mcpServer = createCopyrMcpServer(core);
  const client = new Client({ name: "copyr-assistant", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

  return {
    async listTools() {
      const res = await client.listTools();
      return res.tools
        .map((t) => ({ name: t.name, description: t.description ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async call(name, args, session) {
      const result = await runWithSession(session, () =>
        client.callTool({ name, arguments: args }),
      );

      if (result.isError) {
        const text =
          (result.content as McpTextContent[] | undefined)
            ?.map((c) => c.text ?? "")
            .join("\n") || "tool error";
        throw new Error(text.slice(0, 300));
      }

      const texts = ((result.content as McpTextContent[] | undefined) ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "");
      const joined = texts.join("\n");
      try {
        return JSON.parse(joined);
      } catch {
        return joined;
      }
    },
  };
}
