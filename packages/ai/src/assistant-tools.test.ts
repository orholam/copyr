import { describe, expect, it } from "vitest";
import { formatToolCatalog, normalizeAssistantToolCalls, requiredArgNames } from "./assistant-tools.js";

const createCompanySpec = {
  name: "create_company",
  description: "Create a company",
  inputSchema: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string" },
      domain: { type: "string" },
      sector: { type: "string" },
    },
  },
};

describe("formatToolCatalog", () => {
  it("shows required vs optional arguments", () => {
    const catalog = formatToolCatalog([createCompanySpec]);
    expect(catalog).toContain("create_company(name, domain?, sector?)");
    expect(catalog).toContain("Create a company");
  });

  it("omits a signature when no schema is provided", () => {
    expect(formatToolCatalog([{ name: "ping", description: "health" }])).toBe("- ping: health");
  });
});

describe("requiredArgNames", () => {
  it("reads JSON Schema required", () => {
    expect(requiredArgNames(createCompanySpec.inputSchema)).toEqual(["name"]);
    expect(requiredArgNames(undefined)).toEqual([]);
  });
});

describe("normalizeAssistantToolCalls", () => {
  const allowed = ["create_company"];

  it("keeps args as-is", () => {
    expect(
      normalizeAssistantToolCalls(
        [{ name: "create_company", args: { name: "OpenAI" } }],
        allowed,
      ),
    ).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
  });

  it("reads OpenAI-style arguments object", () => {
    expect(
      normalizeAssistantToolCalls(
        [{ name: "create_company", arguments: { name: "Anthropic" } }],
        allowed,
      ),
    ).toEqual([{ name: "create_company", args: { name: "Anthropic" } }]);
  });

  it("parses arguments JSON strings", () => {
    expect(
      normalizeAssistantToolCalls(
        [{ name: "create_company", arguments: '{"name":"OpenAI"}' }],
        allowed,
      ),
    ).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
  });

  it("reads nested function.arguments", () => {
    expect(
      normalizeAssistantToolCalls(
        [{ function: { name: "create_company", arguments: { name: "OpenAI" } } }],
        allowed,
      ),
    ).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
  });

  it("lifts leftover fields when name came from tool", () => {
    expect(
      normalizeAssistantToolCalls([{ tool: "create_company", name: "OpenAI" }], allowed),
    ).toEqual([{ name: "create_company", args: { name: "OpenAI" } }]);
  });

  it("drops unknown tools", () => {
    expect(normalizeAssistantToolCalls([{ name: "rm_rf", args: {} }], allowed)).toEqual([]);
  });
});
