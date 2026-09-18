import type { AssistantToolCall, AssistantToolSpec } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Required argument names from a JSON Schema object. */
export function requiredArgNames(schema: Record<string, unknown> | undefined): string[] {
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required.filter((k): k is string => typeof k === "string" && k.length > 0);
}

function argSignature(schema: Record<string, unknown> | undefined): string {
  if (!schema) return "";
  const properties = schema.properties;
  if (!isRecord(properties)) return "";
  const keys = Object.keys(properties);
  if (!keys.length) return "()";
  const required = new Set(requiredArgNames(schema));
  return `(${keys.map((k) => (required.has(k) ? k : `${k}?`)).join(", ")})`;
}

/** Compact catalog so the model sees required vs optional arguments. */
export function formatToolCatalog(tools: AssistantToolSpec[]): string {
  return tools
    .map((t) => `- ${t.name}${argSignature(t.inputSchema)}: ${t.description}`)
    .join("\n");
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (isRecord(raw)) return { ...raw };
  return {};
}

/**
 * Models emit OpenAI-style `arguments`, nested `function`, or extra top-level
 * fields instead of `args`. Collapse those shapes onto `{ name, args }`.
 */
export function normalizeAssistantToolCalls(
  raw: unknown,
  allowed: Iterable<string>,
): AssistantToolCall[] {
  if (!Array.isArray(raw)) return [];
  const allow = allowed instanceof Set ? allowed : new Set(allowed);
  const out: AssistantToolCall[] = [];

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const fn = isRecord(item.function) ? item.function : undefined;

    let name = "";
    const reserved = new Set(["args", "arguments", "parameters", "function", "type", "id", "index"]);
    if (typeof item.name === "string" && allow.has(item.name)) {
      name = item.name;
      reserved.add("name");
    } else if (typeof item.tool === "string" && allow.has(item.tool)) {
      name = item.tool;
      reserved.add("tool");
    } else if (fn && typeof fn.name === "string" && allow.has(fn.name)) {
      name = fn.name;
    }
    if (!name) continue;

    let args = parseArgs(item.args ?? item.arguments ?? item.parameters ?? fn?.arguments ?? fn?.args);
    if (!Object.keys(args).length) {
      const lifted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(item)) {
        if (reserved.has(k) || v === undefined) continue;
        lifted[k] = v;
      }
      args = lifted;
    }

    out.push({ name, args });
  }

  return out;
}
