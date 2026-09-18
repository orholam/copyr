import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleProvider } from "./openai.js";

const createCompanyTool = {
  name: "create_company",
  description: "Create a company",
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      domain: { type: "string" },
    },
  },
};

describe("OpenAiCompatibleProvider.assistantTurn", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("advertises required args and maps OpenAI-style arguments onto args", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    toolCalls: [{ name: "create_company", arguments: { name: "OpenAI" } }],
                  }),
                },
              },
            ],
          }),
        };
      }),
    );

    const provider = new OpenAiCompatibleProvider({
      apiKey: "sk-test",
      baseUrl: "http://llm.local/v1",
      model: "gpt-test",
    });
    const turn = await provider.assistantTurn({
      messages: [{ role: "user", content: "Add OpenAI and Anthropic to the pipeline" }],
      tools: [createCompanyTool],
    });

    expect(turn.toolCalls).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
    const userMsg = (bodies[0]?.messages as Array<{ role: string; content: string }>).find((m) => m.role === "user");
    expect(userMsg?.content).toContain("create_company(name, domain?)");
    const systemMsg = (bodies[0]?.messages as Array<{ role: string; content: string }>).find((m) => m.role === "system");
    expect(systemMsg?.content).toContain("never call a required-arg tool with empty args");
  });
});
