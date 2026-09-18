import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../../lib/api";
import { RichText } from "../../components/RichText";
import { Button, Spinner, cx, timeAgo } from "../../components/ui";
import { IconCheck, IconPlus, IconSearch, IconSpark, IconX } from "../../components/icons";

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[] | null;
  toolName?: string | null;
  toolArgs?: Record<string, unknown> | null;
  ok?: boolean | null;
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}

interface TurnResult {
  conversation: Conversation;
  messages: Message[];
}

type ToolRun = { name: string; status: "running" | "done"; ok?: boolean; ms?: number };

const SUGGESTIONS = [
  { title: "Pipeline pulse", prompt: "How is the pipeline looking?" },
  { title: "Needs attention", prompt: "Which deals need attention?" },
  { title: "Ask the corpus", prompt: "What do customer contracts say about change of control?" },
  { title: "Portfolio digest", prompt: "Summarize recent portfolio updates" },
];

const DAY = 86_400_000;

/** Bucket a timestamp into fixed history sections (newest → oldest). */
function groupLabel(iso: string): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = new Date(iso).getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - DAY) return "Yesterday";
  if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
  if (t >= startOfToday - 30 * DAY) return "Previous 30 days";
  return "Older";
}

function formatToolLabel(name: string, args?: Record<string, unknown> | null): string {
  if (!args || !Object.keys(args).length) return `${name}()`;
  const inner = Object.entries(args)
    .slice(0, 4)
    .map(([k, v]) => {
      const shown = typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v);
      return `${k}=${(shown ?? "null").slice(0, 48)}`;
    })
    .join(", ");
  return `${name}(${inner})`;
}

const GROUP_ORDER = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export default function Assistant() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [params, setParams] = useSearchParams();
  const cParam = params.get("c");

  /** Deep link: /app?c=<id> opens a saved conversation. */
  useEffect(() => {
    if (cParam && cParam !== activeId) setActiveId(cParam);
  }, [cParam, activeId]);

  const setCParam = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("c", id);
    else next.delete("c");
    setParams(next, { replace: true });
  };

  const openConversation = (id: string) => {
    setActiveId(id);
    setCParam(id);
  };

  const threadsQ = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api.get<Conversation[]>("/assistant/conversations"),
  });

  const removeThread = useMutation({
    mutationFn: (id: string) => api.delete(`/assistant/conversations/${id}`),
    onSuccess: (_data, id) => {
      if (activeId === id) {
        setActiveId(null);
        setCParam(null);
        qc.removeQueries({ queryKey: ["conversation", id] });
      }
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  const groups = useMemo(() => {
    const byGroup = new Map<string, Conversation[]>();
    for (const c of threadsQ.data ?? []) {
      const label = groupLabel(c.lastMessageAt);
      const list = byGroup.get(label);
      if (list) list.push(c);
      else byGroup.set(label, [c]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map(
      (g) => [g, byGroup.get(g)!] as const,
    );
  }, [threadsQ.data]);

  const threadQ = useQuery({
    queryKey: ["conversation", activeId],
    queryFn: () =>
      api.get<{ conversation: Conversation; messages: Message[] }>(
        `/assistant/conversations/${activeId}`,
      ),
    enabled: !!activeId,
  });

  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [turn, setTurn] = useState<null | { tools: ToolRun[]; reply: string }>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const quietIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [threadQ.data?.messages.length, pendingUser, turn?.tools.length, turn?.reply.length]);

  async function finish(result: TurnResult) {
    // rows delivered by this turn must not replay entrance animations on handoff
    result.messages.forEach((m) => quietIds.current.add(m.id));
    qc.setQueryData(["conversation", result.conversation.id], result);
    void qc.invalidateQueries({ queryKey: ["conversations"] });
    setActiveId(result.conversation.id);
    setCParam(result.conversation.id);
    setPendingUser(null);
    setTurn(null);
  }

  /** Streams one chat turn over SSE; falls back to the sync endpoint on 404. */
  async function submit(content: string) {
    const clean = content.trim();
    if (!clean || turn) return;
    setSendError(null);
    setPendingUser(clean);
    setTurn({ tools: [], reply: "" });
    try {
      const result = await new Promise<TurnResult>((resolve, reject) => {
        let settled = false;
        const ok = (r: TurnResult) => {
          if (!settled) {
            settled = true;
            resolve(r);
          }
        };
        const fail = (e: Error) => {
          if (!settled) {
            settled = true;
            reject(e);
          }
        };
        void api
          .stream("/assistant/messages/stream", { content: clean, conversationId: activeId }, (evt) => {
            if (evt.type === "tool_start") {
              setTurn((t) => t && { ...t, tools: [...t.tools, { name: String(evt.name), status: "running" }] });
            } else if (evt.type === "tool_end") {
              const ok = Boolean(evt.ok);
              const ms = Number(evt.ms);
              setTurn((t) =>
                t && {
                  ...t,
                  tools: t.tools.map((x) =>
                    x.status === "running" ? { ...x, status: "done" as const, ok, ms } : x,
                  ),
                },
              );
            } else if (evt.type === "delta") {
              const text = String(evt.text ?? "");
              setTurn((t) => t && { ...t, reply: t.reply + text });
            } else if (evt.type === "error") {
              fail(new Error(String(evt.message)));
            } else if (evt.type === "done") {
              ok(evt.result as TurnResult);
            }
          })
          .then(() => fail(new Error("Connection closed mid-turn")))
          .catch(fail);
      });
      await finish(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        try {
          const result = await api.post<TurnResult>("/assistant/messages", {
            content: clean,
            conversationId: activeId,
          });
          await finish(result);
          return;
        } catch (fallbackErr) {
          setSendError(fallbackErr instanceof Error ? fallbackErr.message : "Something went wrong");
          setPendingUser(null);
          setTurn(null);
          return;
        }
      }
      setSendError(err instanceof Error ? err.message : "Something went wrong");
      setPendingUser(null);
      setTurn(null);
    }
  }

  const messages = threadQ.data?.messages ?? [];
  const isEmpty = !messages.length && !pendingUser && !turn;

  return (
    <div className="flex h-full min-h-0">
      {/* History rail */}
      {showHistory ? (
        <aside
          className={cx(
            "relative shrink-0 overflow-hidden bg-paper-50/60 transition-all duration-300 ease-[cubic-bezier(.21,.61,.35,1)]",
            showHistory ? "w-64 opacity-100" : "w-0 opacity-0",
          )}
        >
          <div className="flex h-full w-64 flex-col border-r border-paper-900/[0.08]">
          <div className="flex items-center justify-between px-3 pb-2 pt-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-paper-500">History</span>
            <span className="flex items-center gap-2">
              <button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("copyr:search", { detail: { filter: "conversations" } }),
                  )
                }
                className="text-paper-400 transition-colors hover:text-brand-700"
                title="Search conversations"
              >
                <IconSearch width={12} height={12} />
              </button>
              <button
                onClick={() => setShowHistory(false)}
                className="text-[10px] text-paper-400 hover:text-paper-700"
                title="Hide history"
              >
                hide
              </button>
            </span>
          </div>
          <div className="px-3 pb-2">
            <Button
              size="sm"
              className="w-full"
              onClick={() => {
                setActiveId(null);
                setCParam(null);
                qc.removeQueries({ queryKey: ["conversation"] });
              }}
            >
              <IconPlus width={13} height={13} /> New chat
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
            {groups.map(([label, items]) => (
              <div key={label} className="mb-1.5">
                <p className="px-2 pb-0.5 pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-paper-400">
                  {label}
                  <span className="num ml-1 font-medium normal-case tracking-normal text-paper-300">{items.length}</span>
                </p>
                {items.map((c) => (
                  <div
                    key={c.id}
                    className={cx(
                      "group relative rounded-lg border border-transparent transition",
                      activeId === c.id ? "border-brand-500/25 bg-brand-50" : "hover:bg-paper-900/[0.04]",
                    )}
                  >
                    <button
                      onClick={() => openConversation(c.id)}
                      className="block w-full py-1.5 pl-2.5 pr-7 text-left"
                    >
                      <p className={cx("truncate text-xs font-medium", activeId === c.id ? "text-brand-800" : "text-paper-800")}>
                        {c.title}
                      </p>
                      <p className="text-[10px] text-paper-400">
                        {c.messageCount} msg{c.messageCount === 1 ? "" : "s"} · {timeAgo(c.lastMessageAt)}
                      </p>
                    </button>
                    <button
                      onClick={() => removeThread.mutate(c.id)}
                      disabled={removeThread.isPending}
                      title="Delete conversation"
                      className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded p-1 text-paper-300 transition hover:bg-red-50 hover:text-red-600 group-hover:block"
                    >
                      <IconX width={11} height={11} />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="border-t border-paper-900/[0.07] px-3 py-2 text-[10.5px] leading-relaxed text-paper-600">
            Every conversation is saved here — reviewable by the whole firm.
          </p>
          </div>
        </aside>
      ) : (
        <button
          onClick={() => setShowHistory(true)}
          className="shrink-0 border-r border-paper-900/[0.08] px-2 text-[10px] uppercase tracking-widest text-paper-400 transition-colors hover:bg-paper-900/[0.03] hover:text-paper-700"
          style={{ writingMode: "vertical-rl" }}
        >
          History
        </button>
      )}

      {/* Conversation column */}
      <section className="relative flex min-w-0 flex-1 flex-col">
        {/* ambient backdrop */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-50/70 to-transparent" />

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 py-8">
            {isEmpty ? (
              <div className="flex min-h-[52vh] flex-col items-center justify-center text-center">
                <span className="btn-ink animate-pop relative flex h-11 w-11 items-center justify-center rounded-2xl text-paper-50">
                  <span aria-hidden className="absolute inset-0 animate-ping rounded-2xl bg-paper-900/20 [animation-duration:2.6s]" />
                  <IconSpark width={20} height={20} />
                </span>
                <h1 className="animate-fade-up mt-4 font-serif text-2xl italic text-paper-900 [animation-delay:60ms]">
                  Good to see you. What should we dig into?
                </h1>
                <p className="animate-fade-up mt-2 max-w-md text-sm leading-relaxed text-paper-500 [animation-delay:120ms]">
                  One conversation over your entire fund — pipeline, diligence vaults,
                  portfolio, codified agents and memory. Grounded in your workspace,
                  never guessing.
                </p>
                <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={s.title}
                      style={{ animationDelay: `${160 + i * 50}ms` }}
                      onClick={() => void submit(s.prompt)}
                      className="group animate-fade-up rounded-xl border border-paper-900/[0.09] bg-white px-3.5 py-3 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-[0_8px_20px_-10px_rgba(23,22,19,0.25)]"
                    >
                      <p className="text-xs font-semibold text-paper-900 transition-colors group-hover:text-brand-800">{s.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-paper-500">{s.prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
              {messages.map((m, idx) => {
                const delay = Math.min(idx * 30, 180);
                const quiet = quietIds.current.has(m.id);
                if (m.role === "tool") {
                  return (
                    <details key={m.id} className={cx("pl-12", !quiet && "animate-fade-in")} style={quiet ? undefined : { animationDelay: `${delay}ms` }}>
                      <summary
                        className={cx(
                          "inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-2.5 font-mono text-[10px] shadow-card transition-colors [&::-webkit-details-marker]:hidden",
                          m.ok === false
                            ? "border-red-200 bg-red-50 text-red-600"
                            : "border-emerald-200 bg-white text-emerald-700 hover:border-emerald-300",
                        )}
                      >
                        {m.ok === false ? <IconX width={9} height={9} strokeWidth={3} /> : <IconCheck width={10} height={10} strokeWidth={3} />}
                        {formatToolLabel(m.toolName ?? "tool", m.toolArgs)}
                      </summary>
                      <pre className="mt-1 max-h-44 max-w-xl overflow-auto whitespace-pre-wrap rounded-lg border border-paper-900/[0.08] bg-paper-50 p-2.5 font-mono text-[10px] leading-relaxed text-paper-600">
                        {m.content}
                      </pre>
                    </details>
                  );
                }
                if (m.role === "assistant") {
                  if (!m.content && !m.toolCalls) {
                    return (
                      <div key={m.id} className={cx("flex items-start gap-3", !quiet && "animate-fade-in")}>
                        <Avatar active />
                        <div className="flex items-center gap-1.5 pt-2" aria-label="assistant is working">
                          <i className="thinking-dot" />
                          <i className="thinking-dot" style={{ animationDelay: "150ms" }} />
                          <i className="thinking-dot" style={{ animationDelay: "300ms" }} />
                          <span className="ml-1.5 text-xs text-paper-400">working through tools</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={m.id} className={cx("flex items-start gap-3", !quiet && "animate-fade-in")} style={quiet ? undefined : { animationDelay: `${delay}ms` }}>
                      <Avatar />
                      <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                        {!!m.toolCalls?.length && (
                          <div className="flex flex-wrap gap-1">
                            {m.toolCalls.map((tc, i) => (
                              <span key={i} className="inline-flex items-center rounded-full border border-brand-300 bg-brand-50 px-2 py-0.5 font-mono text-[10px] text-brand-700">
                                {formatToolLabel(tc.name, tc.args)}
                              </span>
                            ))}
                          </div>
                        )}
                        {m.content && (
                          <div className="rounded-lg border border-paper-900/[0.08] bg-white px-3.5 py-2.5 shadow-sm">
                            <RichText text={m.content} className="space-y-2" />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={cx("flex justify-end pl-10", !quiet && "animate-fade-up")} style={quiet ? undefined : { animationDelay: `${delay}ms` }}>
                    <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-paper-900 px-3.5 py-2.5 text-sm leading-relaxed text-paper-50 shadow-[0_2px_8px_-2px_rgba(23,22,19,0.3)]">
                      {m.content}
                    </div>
                  </div>
                );
              })}
              </div>
            )}
            {pendingUser && (
              <div className="animate-fade-up flex justify-end pl-10">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-xl rounded-tr-sm bg-paper-900 px-3.5 py-2.5 text-sm leading-relaxed text-paper-50 shadow-[0_2px_8px_-2px_rgba(23,22,19,0.3)]">
                  {pendingUser}
                </div>
              </div>
            )}
            {turn && <LiveTurn tools={turn.tools} reply={turn.reply} />}
            {sendError && (
              <p className="animate-shake pl-12 text-xs text-red-600">{sendError}</p>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="relative px-6 pb-5">
          <div className="mx-auto w-full max-w-3xl">
            {!isEmpty && !turn && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {SUGGESTIONS.slice(0, 3).map((s) => (
                  <button
                    key={s.title}
                    onClick={() => void submit(s.prompt)}
                    className="animate-fade-in rounded-full border border-paper-900/[0.12] bg-white px-2.5 py-1 text-[11px] text-paper-500 transition-all duration-150 hover:-translate-y-px hover:border-brand-500/40 hover:text-brand-700 hover:shadow-card"
                  >
                    {s.title.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(draft);
              }}
              className="flex items-center gap-2 rounded-xl border border-paper-900/[0.14] bg-white p-2 shadow-[0_2px_12px_rgba(23,22,19,0.06)] transition-all duration-200 focus-within:-translate-y-px focus-within:border-brand-500 focus-within:shadow-[0_8px_24px_-8px_rgba(23,22,19,0.2)] focus-within:ring-[3px] focus-within:ring-brand-500/10"
            >
              <input
                autoFocus
                className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-paper-900 outline-none placeholder:text-paper-400"
                placeholder="Ask anything — “which deals need attention?”"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!!turn}
              />
              <Button type="submit" size="sm" disabled={!draft.trim() || !!turn}>
                {turn ? <Spinner /> : "Send"}
              </Button>
            </form>
            <p className="mt-1.5 text-center text-[10px] text-paper-500">
              Answers are grounded in workspace material with citations — verify anything before it leaves the building.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function LiveTurn({ tools, reply }: { tools: ToolRun[]; reply: string }) {
  const working = tools.some((t) => t.status === "running");
  return (
    <div className="animate-fade-in flex items-start gap-3">
      <Avatar active={working || (!reply && tools.length > 0)} />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        {!!tools.length && (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <span
                key={`${t.name}-${i}`}
                style={{ animationDelay: `${i * 60}ms` }}
                className={cx(
                  "animate-pop inline-flex items-center gap-1.5 rounded-full border py-0.5 pl-2 pr-2.5 font-mono text-[10px] shadow-card",
                  t.status === "running"
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : t.ok
                      ? "border-emerald-200 bg-white text-emerald-700"
                      : "border-red-200 bg-red-50 text-red-600",
                )}
              >
                {t.status === "running" ? (
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-brand-300 border-t-brand-600" />
                ) : t.ok ? (
                  <IconCheck width={10} height={10} strokeWidth={3} />
                ) : (
                  <IconX width={9} height={9} strokeWidth={3} />
                )}
                {t.name}()
                {typeof t.ms === "number" && <span className="num text-paper-400">{t.ms}ms</span>}
              </span>
            ))}
          </div>
        )}
        {!reply ? (
          <div className="flex items-center gap-1.5 pt-0.5" aria-label="assistant is working">
            <i className="thinking-dot" />
            <i className="thinking-dot" style={{ animationDelay: "150ms" }} />
            <i className="thinking-dot" style={{ animationDelay: "300ms" }} />
            <span className="ml-1.5 text-xs text-paper-400">
              {tools.length ? "synthesizing an answer" : "working through tools"}
            </span>
          </div>
        ) : (
          <div className="rounded-lg border border-paper-900/[0.08] bg-white px-3.5 py-2.5 shadow-sm">
            <RichText text={reply} className="stream-caret space-y-2" />
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ active = false }: { active?: boolean }) {
  return (
    <span className="relative mt-0.5 shrink-0">
      {active && (
        <span aria-hidden className="absolute inset-0 animate-ping rounded-lg bg-brand-500/30 [animation-duration:1.6s]" />
      )}
      <span className="btn-ink relative flex h-7 w-7 items-center justify-center rounded-lg text-paper-50">
        <IconSpark width={13} height={13} />
      </span>
    </span>
  );
}
