import { describe, expect, it } from "vitest";
import {
  extractCreateCompanyNames,
  fillMissingToolArgs,
  formatToolCatalog,
  missingRequiredArgs,
  normalizeAssistantToolCalls,
  requiredArgNames,
} from "./assistant-tools.js";

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

describe("extractCreateCompanyNames", () => {
  it("reads add-to-pipeline phrasing", () => {
    expect(extractCreateCompanyNames("Add OpenAI to the pipeline")).toEqual(["OpenAI"]);
    expect(extractCreateCompanyNames("Add OpenAI and Anthropic to the pipeline")).toEqual([
      "OpenAI",
      "Anthropic",
    ]);
  });

  it("reads quoted names and create_company for X", () => {
    expect(extractCreateCompanyNames('Create company "Nimbus Health"')).toEqual(["Nimbus Health"]);
    expect(extractCreateCompanyNames("create_company for Stripe")).toEqual(["Stripe"]);
  });
});

describe("fillMissingToolArgs / missingRequiredArgs", () => {
  it("fills create_company name from the user message", () => {
    expect(missingRequiredArgs(createCompanySpec.inputSchema, {})).toEqual(["name"]);
    expect(
      fillMissingToolArgs(createCompanySpec, {}, "Add OpenAI to the pipeline"),
    ).toEqual({ name: "OpenAI" });
  });

  it("fills create_deal companyName even without a required array", () => {
    expect(
      fillMissingToolArgs(
        { name: "create_deal", description: "alias" },
        {},
        "Add Anthropic to the pipeline",
      ),
    ).toEqual({ companyName: "Anthropic", name: "Anthropic" });
  });
});
