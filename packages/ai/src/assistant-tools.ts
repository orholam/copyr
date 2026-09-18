import type { AssistantToolCall, AssistantToolSpec } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Required argument names from a JSON Schema object. */
export function requiredArgNames(schema: Record<string, unknown> | undefined): string[] {
  if (!schema || !Array.isArray(schema.required)) return [];
  return schema.required.filter((k): k is string => typeof k === "string" && k.length > 0);
}

const emptyArg = (v: unknown) => v === undefined || v === null || v === "";

/** Required keys that are missing or empty on `args`. */
export function missingRequiredArgs(
  schema: Record<string, unknown> | undefined,
  args: Record<string, unknown>,
): string[] {
  return requiredArgNames(schema).filter((k) => emptyArg(args[k]));
}

const NAME_STOP = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "our",
  "your",
  "new",
  "company",
  "companies",
  "deal",
  "deals",
  "pipeline",
  "board",
  "card",
  "cards",
  "crm",
  "kanban",
]);

function cleanCompanyLabel(raw: string): string | null {
  const t = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the|new)\s+/i, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
  if (t.length < 2 || t.length > 80) return null;
  if (NAME_STOP.has(t.toLowerCase())) return null;
  return t;
}

/**
 * Pull company names out of chat like "Add OpenAI to the pipeline"
 * or `create_company for Anthropic`.
 */
export function extractCreateCompanyNames(text: string, max = 4): string[] {
  const names: string[] = [];
  const add = (raw: string) => {
    const t = cleanCompanyLabel(raw);
    if (!t) return;
    if (names.some((n) => n.toLowerCase() === t.toLowerCase())) return;
    names.push(t);
  };

  for (const m of text.matchAll(/["“]([^"”]{2,80})["”]/g)) add(m[1]!);

  const addTo = text.match(
    /\b(?:add|create|new|put|open)\s+(.+?)\s+to\s+(?:the\s+)?(?:pipeline|board|crm|kanban)\b/i,
  );
  if (addTo) {
    for (const part of addTo[1]!.split(/\s*(?:,|&|and)\s*/i)) add(part);
  }

  const named = text.match(
    /\b(?:company|deal)\s+(?:called|named)\s+([A-Z][\w&.+-]*(?:\s+[A-Z][\w&.+-]*){0,3})/,
  );
  if (named) add(named[1]!);

  const forName = text.match(
    /\b(?:for|named|called)\s+([A-Z][\w&.+-]*(?:\s+[A-Z][\w&.+-]*){0,3})/,
  );
  if (forName) add(forName[1]!);

  if (!names.length) {
    const addBare = text.match(
      /\b(?:add|create)\s+([A-Z][\w&.+-]*(?:\s+[A-Z][\w&.+-]*){0,3})\b/,
    );
    if (addBare) add(addBare[1]!);
  }

  return names.slice(0, max);
}

/**
 * Fill required/known create args from the user utterance so empty
 * `create_company()` / `create_deal()` calls still work.
 */
export function fillMissingToolArgs(
  spec: AssistantToolSpec,
  args: Record<string, unknown>,
  userMessage: string,
): Record<string, unknown> {
  const next = { ...args };
  const names = extractCreateCompanyNames(userMessage);
  const first = names[0];

  if (spec.name === "create_company" && emptyArg(next.name) && first) next.name = first;
  if (
    spec.name === "create_deal" &&
    emptyArg(next.companyId) &&
    emptyArg(next.companyName) &&
    emptyArg(next.name) &&
    first
  ) {
    next.companyName = first;
  }
  if (emptyArg(next.name) && next.companyName && typeof next.companyName === "string") {
    next.name = next.companyName;
  }

  const missing = missingRequiredArgs(spec.inputSchema, next);
  if (missing.includes("question") && emptyArg(next.question)) {
    next.question = userMessage.slice(0, 500);
  }
  if (missing.includes("content") && emptyArg(next.content)) {
    next.content = userMessage.slice(0, 1000);
  }
  if (missing.includes("name") && emptyArg(next.name) && first) next.name = first;

  return next;
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
