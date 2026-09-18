import { and, asc, desc, eq, sql } from "drizzle-orm";
import { conversations, messages } from "@copyr/db/schema.js";
import type { ConversationDto, MessageDto } from "@copyr/contracts";
import { requiredArgNames, type AssistantToolSpec } from "@copyr/ai";
import { CoreError, type CoreContext, type Session } from "../context.js";
import { logActivity } from "../activity.js";
import { spendCredits } from "../credits.js";
import { toIso } from "../mappers.js";

/**
 * The central Assistant: one chat surface over every product capability.
 * Each turn lets the provider request tool calls from a curated registry;
 * results are fed back until a final reply is produced. Every step is
 * persisted so threads are reviewable History.
 */

const MAX_TOOL_ROUNDS = 4;

type ToolExec = (ctx: CoreContext, session: Session, args: Record<string, unknown>) => Promise<unknown>;

interface ToolDef {
  description: string;
  exec: ToolExec;
}

/** Curated toolset — read-heavy plus a few safe write actions. */
export const ASSISTANT_TOOLS: Record<string, ToolDef> = {
  analytics_overview: {
    description: "Firm KPIs: active deals, pipeline $, conversion, stage breakdown",
    exec: async (ctx, session) => {
      const { analyticsOverview } = await import("./analytics.js");
      return analyticsOverview(ctx, session);
    },
  },
  list_deals: {
    description: "List deals; supports q, limit, sort (updated_at|created_at|priority|position), order (asc|desc)",
    exec: async (ctx, session, args) => {
      const { listDealsQuerySchema } = await import("@copyr/contracts");
      const q = listDealsQuerySchema.parse({
        limit: typeof args.limit === "number" ? Math.min(args.limit, 10) : 5,
        ...(typeof args.q === "string" ? { q: args.q } : {}),
        ...(args.sort === "updated_at" || args.sort === "created_at" || args.sort === "priority" ? { sort: args.sort } : {}),
        ...(args.order === "asc" || args.order === "desc" ? { order: args.order } : {}),
      });
      const { items } = await import("./deals.js").then((m) => m.listDeals(ctx, session, q));
      return items.map((d) => ({
        dealId: d.id,
        companyName: d.company.name,
        title: d.title,
        roundStage: d.roundStage,
        askAmount: d.askAmount,
        updatedAt: d.updatedAt,
      }));
    },
  },
  search_companies: {
    description: "Search companies by name/domain/sector",
    exec: async (ctx, session, args) => {
      const { listCompanies } = await import("./companies.js");
      return listCompanies(ctx, session, {
        q: typeof args.q === "string" ? args.q : undefined,
        limit: 5,
        offset: 0,
      }).then((r) =>
        r.items.map((c) => ({ companyId: c.id, name: c.name, sector: c.sector, status: c.status, description: c.description })),
      );
    },
  },
  list_portfolio_updates: {
    description: "Recent portfolio company updates (milestones, metrics, hiring)",
    exec: async (ctx, session, args) => {
      const r = await import("./content.js").then((m) =>
        m.listPortfolioUpdates(ctx, session, { limit: typeof args.limit === "number" ? Math.min(args.limit, 10) : 8 }),
      );
      return r.items.map((u) => ({ kind: u.kind, companyName: u.companyName, title: u.title, occurredAt: u.occurredAt }));
    },
  },
  ask_knowledge: {
    description: "Grounded research over workspace material with citations. Use for factual questions.",
    exec: async (ctx, session, args) => {
      const { ask } = await import("./research.js");
      const report = await ask(ctx, session, {
        question: String(args.question ?? "").slice(0, 500),
        includeFirmContext: true,
      });
      return {
        answer: report.answer.slice(0, 1200),
        citations: report.citations.map((c) => ({ sourceName: c.sourceName })),
      };
    },
  },
  list_vaults: {
    description: "Diligence vaults with document and review-table counts",
    exec: async (ctx, session) => {
      const { listVaults } = await import("./vaults.js");
      return (await listVaults(ctx, session)).map((v) => ({
        vaultId: v.id,
        name: v.name,
        documents: v.documentCount,
        parsed: v.parsedDocumentCount,
        reviewTables: v.reviewTableCount,
      }));
    },
  },
  list_agents: {
    description: "Codified fund agents and their run counts",
    exec: async (ctx, session) => {
      const { listAgents } = await import("./agents.js");
      return (await listAgents(ctx, session)).map((a) => ({
        agentId: a.id,
        name: a.name,
        kind: a.kind,
        isActive: a.isActive,
        runCount: a.runCount,
      }));
    },
  },
  list_agent_runs: {
    description: "Recent codified-agent runs with status",
    exec: async (ctx, session) => {
      const { listRuns } = await import("./agents.js");
      return listRuns(ctx, session, { limit: 5 }).then((r) =>
        r.items.map((x) => ({ runId: x.id, agentName: x.agentName, status: x.status, output: x.output })),
      );
    },
  },
  list_tasks: {
    description: "Open diligence/space tasks",
    exec: async (ctx, session) => {
      const { listTasks } = await import("./spaces.js");
      const r = await listTasks(ctx, session, {});
      return r.items.filter((t) => t.status !== "done").slice(0, 8).map((t) => ({
        taskId: t.id,
        title: t.title,
        status: t.status,
        assigneeAgentName: t.assigneeAgentName ?? t.assigneeName ?? null,
      }));
    },
  },
  command_center_overview: {
    description: "Deployment adoption metrics, benchmarks and recommendations",
    exec: async (ctx, session) => {
      const { commandCenter } = await import("./commandcenter.js");
      const report = await commandCenter(ctx, session);
      return {
        aiLeveragePct: report.activity30d.aiLeveragePct,
        adoption: report.adoption,
        recommendations: report.recommendations.slice(0, 3),
      };
    },
  },
  remember: {
    description: "Store a durable fund preference/fact for future answers. Input: content.",
    exec: async (ctx, session, args) => {
      const { remember } = await import("./memory.js");
      const m = await remember(ctx, session, {
        content: String(args.content ?? "").slice(0, 1000),
        kind: args.kind === "fact" || args.kind === "process" || args.kind === "focus_area" ? args.kind : "preference",
        pinned: false,
      });
      return { memoryId: m.id, remembered: m.content };
    },
  },
};

/* ── tool host ─────────────────────────────────────────────────────── */

/**
 * Where the assistant gets its tools. The default is the curated built-in
 * registry below; apps can inject the full MCP surface instead (the API does,
 * via an in-process bridge to the main MCP server).
 */
export interface AssistantToolHost {
  listTools(): Promise<AssistantToolSpec[]>;
  call(name: string, args: Record<string, unknown>, session: Session): Promise<unknown>;
}

function builtinHost(ctx: CoreContext): AssistantToolHost {
  return {
    async listTools() {
      return Object.entries(ASSISTANT_TOOLS).map(([name, def]) => ({
        name,
        description: def.description,
      }));
    },
    async call(name, args, session) {
      const def = ASSISTANT_TOOLS[name];
      if (!def) throw new Error(`Unknown tool ${name}`);
      return def.exec(ctx, session, args);
    },
  };
}

/**
 * MCP returns full DTOs (ids, timestamps, nulls, embedded blobs). Compact them
 * so the transcript stays readable for synthesis and cheap for real models.
 */
const DROP_KEYS = new Set(["workspaceId", "data", "position", "createdByUserId", "userId", "kindHint"]);

function compactToolResult(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "string")
    return value.length > 400 ? `${value.slice(0, 397)}…` : value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.slice(0, 10).map((v) => compactToolResult(v, depth + 1)).filter((v) => v !== undefined);
  if (depth >= 4) return "…";
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (DROP_KEYS.has(k)) continue;
    const c = compactToolResult(v, depth + 1);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

/* ── conversation CRUD ─────────────────────────────────────────────── */

export async function createConversation(
  ctx: CoreContext,
  session: Session,
  title?: string,
): Promise<ConversationDto> {
  const [row] = await ctx.db
    .insert(conversations)
    .values({
      workspaceId: session.workspaceId,
      userId: session.actor.userId,
      title: title?.slice(0, 120) || "New conversation",
      createdByUserId: session.actor.userId,
    })
    .returning();
  return mapConversation(row, 0);
}

export async function listConversations(
  ctx: CoreContext,
  session: Session,
): Promise<ConversationDto[]> {
  const rows = await ctx.db
    .select({
      c: conversations,
      messageCount: sql<number>`count(${messages.id})::int`,
    })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(eq(conversations.workspaceId, session.workspaceId))
    .groupBy(conversations.id)
    .orderBy(desc(conversations.lastMessageAt))
    .limit(200);
  return rows.map((r) => mapConversation(r.c, r.messageCount ?? 0));
}

export async function getConversation(
  ctx: CoreContext,
  session: Session,
  conversationId: string,
): Promise<{ conversation: ConversationDto; messages: MessageDto[] }> {
  const [row] = await ctx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, session.workspaceId)));
  if (!row) throw new CoreError("conversation not found", { status: 404 });

  const msgRows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.position));

  return {
    conversation: mapConversation(row, msgRows.length),
    messages: msgRows.map(mapMessage),
  };
}

export async function deleteConversation(
  ctx: CoreContext,
  session: Session,
  conversationId: string,
): Promise<void> {
  const deleted = await ctx.db
    .delete(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.workspaceId, session.workspaceId)))
    .returning({ id: conversations.id });
  if (!deleted.length) throw new CoreError("conversation not found", { status: 404 });
}

/* ── send + tool loop ──────────────────────────────────────────────── */

export interface SendResult {
  conversation: ConversationDto;
  messages: MessageDto[];
}

export type AssistantStreamEvent =
  | { type: "start"; conversationId: string }
  | { type: "tool_start"; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; name: string; ok: boolean; ms: number }
  | { type: "delta"; text: string };

type Emit = (e: AssistantStreamEvent) => void;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function runTurn(
  ctx: CoreContext,
  session: Session,
  conversationId: string | null,
  content: string,
  host: AssistantToolHost,
  emit: Emit | null,
): Promise<SendResult> {
  // resolve / create thread
  let convId = conversationId;
  if (!convId) {
    const created = await createConversation(ctx, session, deriveTitle(content));
    convId = created.id;
  }
  emit?.({ type: "start", conversationId: convId! });
  const [conv] = await ctx.db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, convId), eq(conversations.workspaceId, session.workspaceId)));
  if (!conv) throw new CoreError("conversation not found", { status: 404 });

  const [{ maxPos }] = await ctx.db
    .select({ maxPos: sql<number>`coalesce(max(${messages.position}), -1)::int` })
    .from(messages)
    .where(eq(messages.conversationId, convId));
  let pos = (maxPos ?? -1) + 1;

  const insertMessage = async (
    role: "user" | "assistant" | "tool",
    text: string,
    data?: Record<string, unknown> | null,
  ) => {
    const [row] = await ctx.db
      .insert(messages)
      .values({
        workspaceId: session.workspaceId,
        conversationId: convId!,
        role,
        content: text.slice(0, 12_000),
        data: (data ?? null) as never,
        position: pos++,
      })
      .returning();
    return row;
  };

  await insertMessage("user", content);

  // transcript for the provider (persisted history + fresh turn)
  const priorRows = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(desc(messages.position))
    .limit(24);
  const history = priorRows.reverse().map((m) => {
    if (m.role === "tool") {
      const data = m.data as { name?: string; args?: Record<string, unknown> } | null;
      const prefix = data?.name ? `${data.name}(${JSON.stringify(data.args ?? {})}) → ` : "";
      return { role: "tool" as const, content: `${prefix}${m.content || ""}` };
    }
    return {
      role: m.role,
      content: m.content || JSON.stringify(m.data ?? {}),
    } as { role: "user" | "assistant" | "tool"; content: string };
  });

  const toolSpecs = await host.listTools();

  let rounds = 0;
  let finalReply: string | null = null;
  let creditsUsed = 0;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const turn = await ctx.ai.assistantTurn({ messages: history, tools: toolSpecs });
    creditsUsed += 1;

    if (turn.toolCalls.length) {
      // persist the assistant's intent to call tools
      await insertMessage(
        "assistant",
        "",
        { toolCalls: turn.toolCalls },
      );

      for (const call of turn.toolCalls) {
        emit?.({ type: "tool_start", name: call.name, args: call.args ?? {} });
        const t0 = Date.now();
        let ok = true;
        let resultText: string;
        try {
          const result = await host.call(call.name, call.args ?? {}, session);
          resultText = JSON.stringify(compactToolResult(result)).slice(0, 6_000);
        } catch (err) {
          ok = false;
          const spec = toolSpecs.find((t) => t.name === call.name);
          const required = requiredArgNames(spec?.inputSchema);
          resultText = JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            receivedArgs: call.args ?? {},
            ...(required.length
              ? {
                  requiredArguments: required,
                  hint: `Retry ${call.name} with args including ${required.join(", ")} (from the user message).`,
                }
              : {}),
          }).slice(0, 2_000);
        }
        emit?.({ type: "tool_end", name: call.name, ok, ms: Date.now() - t0 });
        await insertMessage("tool", resultText, { name: call.name, args: call.args ?? {}, ok });
        history.push({
          role: "tool",
          content: `${call.name}(${JSON.stringify(call.args ?? {})}) → ${resultText}`,
        });
      }
      continue;
    }

    finalReply = turn.reply ?? "(empty response)";
    break;
  }

  if (finalReply === null) {
    finalReply =
      "I ran several tool steps without converging on an answer — here is what I gathered above. Try narrowing the question.";
  }

  const replyRow = await insertMessage("assistant", finalReply);

  if (emit) {
    // stream the persisted reply back in small chunks — feels live, works offline
    const tokens = finalReply.match(/\S+\s*|\s+/g) ?? [finalReply];
    const per = Math.max(8, Math.min(26, Math.floor(2800 / Math.max(tokens.length, 1))));
    for (const tok of tokens) {
      emit({ type: "delta", text: tok });
      await sleep(per);
    }
  }

  await ctx.db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, convId));

  await ctx.db.transaction(async (tx) => {
    await spendCredits(ctx, tx as never, session.workspaceId, "assistant_turn", {
      refType: "conversation",
      refId: convId!,
    });
  });
  void creditsUsed;

  await logActivity(ctx, ctx.db, {
    workspaceId: session.workspaceId,
    entityType: "workspace",
    entityId: session.workspaceId,
    type: "assistant.turn",
    summary: `Assistant handled: "${content.slice(0, 80)}"`,
    actor: session.actor.userId ? "user" : "ai",
    actorUserId: session.actor.userId,
  });

  const all = await ctx.db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convId))
    .orderBy(asc(messages.position));

  const [updated] = await ctx.db.select().from(conversations).where(eq(conversations.id, convId));
  void replyRow;

  return {
    conversation: mapConversation(updated!, all.length),
    messages: all.map(mapMessage),
  };
}

/** Synchronous turn (used by tests and the non-streaming route). */
export async function sendMessage(
  ctx: CoreContext,
  session: Session,
  conversationId: string | null,
  content: string,
  toolHost?: AssistantToolHost,
): Promise<SendResult> {
  return runTurn(ctx, session, conversationId, content, toolHost ?? builtinHost(ctx), null);
}

/**
 * Streaming variant — emits progress events (tool lifecycle + reply deltas)
 * as they happen. Persistence is unchanged; the reply row lands before the
 * first delta, so a dropped connection never loses the transcript.
 */
export async function streamMessage(
  ctx: CoreContext,
  session: Session,
  conversationId: string | null,
  content: string,
  toolHost: AssistantToolHost | undefined,
  emit: Emit,
): Promise<SendResult> {
  return runTurn(ctx, session, conversationId, content, toolHost ?? builtinHost(ctx), emit);
}

function deriveTitle(content: string): string {
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}…` : clean || "New conversation";
}

/* ── mappers ───────────────────────────────────────────────────────── */

type ConversationRow = typeof conversations.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function mapConversation(row: ConversationRow, messageCount: number): ConversationDto {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    lastMessageAt: toIso(row.lastMessageAt)!,
    messageCount,
    createdAt: toIso(row.createdAt)!,
  };
}

function mapMessage(row: MessageRow): MessageDto {
  const data = row.data as
    | { toolCalls?: Array<{ name: string; args: Record<string, unknown> }>; name?: string; args?: Record<string, unknown>; ok?: boolean }
    | null;
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    toolCalls: data?.toolCalls ?? undefined,
    toolName: data?.name ?? undefined,
    toolArgs: data?.args ?? undefined,
    ok: data?.ok ?? undefined,
    position: row.position,
    createdAt: toIso(row.createdAt)!,
  };
}
