import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Spinner,
  inputCls,
  timeAgo,
} from "../../components/ui";
import { IconBot, IconPlus, IconSpark } from "../../components/icons";

/* ── types ─────────────────────────────────────────────────────────── */

interface Agent {
  id: string;
  name: string;
  kind: "thesis_screen" | "diligence_checklist" | "portfolio_monitor" | "custom";
  description: string | null;
  instructions: string | null;
  config: {
    mustHaveKeywords?: string[];
    excludeKeywords?: string[];
    checklist?: string[];
    watchItems?: string[];
  };
  isActive: boolean;
  isSystem: boolean;
  version: number;
  runCount: number;
  lastRunAt: string | null;
}

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: Array<{ field: string; op: string; value?: unknown }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  isEnabled: boolean;
  runCount: number;
  lastRunAt: string | null;
}

interface RunItem {
  id: string;
  source: "agent" | "workflow";
  name: string;
  status: string;
  trigger?: string | null;
  summary: string;
  createdAt: string;
}

interface Overview {
  agents: Agent[];
  workflows: Workflow[];
  runs: RunItem[];
  stats: { activeAgents: number; enabledWorkflows: number; runsLast7d: number; chainRunsLast7d: number };
}

const KIND_LABEL: Record<string, string> = {
  thesis_screen: "Thesis screen",
  diligence_checklist: "Checklist builder",
  portfolio_monitor: "Portfolio monitor",
  custom: "Custom",
};

const blankAgent: Agent = {
  id: "",
  name: "",
  kind: "custom",
  description: null,
  instructions: null,
  config: {},
  isActive: true,
  isSystem: false,
  version: 1,
  runCount: 0,
  lastRunAt: null,
};

export default function Automations() {
  const [tab, setTab] = useState<"agents" | "workflows" | "runs">("agents");

  const overviewQ = useQuery({
    queryKey: ["automations-overview"],
    queryFn: () => api.get<Overview>("/automations/overview"),
    refetchInterval: 8000,
  });

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Automations"
        subtitle="Codified judgment (agents) + event reactions (workflows) — one system"
      />

      {/* stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active agents" value={overviewQ.data?.stats.activeAgents ?? 0} />
        <Stat label="Enabled workflows" value={overviewQ.data?.stats.enabledWorkflows ?? 0} />
        <Stat label="Runs this week" value={overviewQ.data?.stats.runsLast7d ?? 0} />
        <Stat label="Chained runs" value={overviewQ.data?.stats.chainRunsLast7d ?? 0} sub="event → agent → action" />
      </div>

      <SegmentedControl
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        options={[
          { value: "agents", label: `Agents (${overviewQ.data?.agents.length ?? 0})` },
          { value: "workflows", label: `Workflows (${overviewQ.data?.workflows.length ?? 0})` },
          { value: "runs", label: "Runs" },
        ]}
      />

      {tab === "agents" && <AgentsTab overviewQ={overviewQ} />}
      {tab === "workflows" && <WorkflowsTab overviewQ={overviewQ} />}
      {tab === "runs" && <RunsTab overviewQ={overviewQ} />}
    </div>
  );
}

/* ── shared bits ───────────────────────────────────────────────────── */

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="panel p-3.5">
      <p className="text-[10px] uppercase tracking-widest text-paper-400">{label}</p>
      <p className="num mt-1 text-2xl font-bold text-paper-900">{value}</p>
      {sub && <p className="text-[11px] text-paper-400">{sub}</p>}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "completed" ? "bg-emerald-500" : status === "failed" ? "bg-red-500" : status === "running" ? "bg-amber-500 animate-pulse" : "bg-paper-300";
  return <span className={cx2("inline-block h-2 w-2 rounded-full", color)} />;
}

function cx2(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ── Agents tab ────────────────────────────────────────────────────── */

function AgentsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  const qc = useQueryClient();
  const [runTarget, setRunTarget] = useState<Agent | null>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);

  if (overviewQ.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}
      </div>
    );
  }
  if (!overviewQ.data?.agents.length) {
    return (
      <EmptyState
        icon={<IconBot width={20} height={20} />}
        title="No agents yet"
        hint="Agents are codified judgment — thesis screens, checklists and monitors that execute end-to-end."
      />
    );
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        {overviewQ.data.agents.map((a) => (
          <div key={a.id} className="panel flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="btn-ink flex h-7 w-7 items-center justify-center rounded-lg text-paper-900">
                    <IconBot width={14} height={14} />
                  </span>
                  <span className="text-sm font-semibold text-paper-900">{a.name}</span>
                  {!a.isActive && <Badge tone="slate">inactive</Badge>}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-paper-500">{a.description ?? KIND_LABEL[a.kind]}</p>
              </div>
              <Badge tone={a.kind === "thesis_screen" ? "indigo" : a.kind === "portfolio_monitor" ? "purple" : "amber"}>
                v{a.version}
              </Badge>
            </div>
            {a.instructions && (
              <p className="mt-3 line-clamp-2 rounded-lg bg-paper-100 px-2.5 py-1.5 text-[11px] italic text-paper-600">
                “{a.instructions.slice(0, 140)}{a.instructions.length > 140 ? "…" : ""}”
              </p>
            )}
            <div className="mt-auto flex items-center justify-between pt-3">
              <span className="text-[11px] text-paper-400">
                {a.runCount} run{a.runCount === 1 ? "" : "s"}{a.lastRunAt ? ` · last ${timeAgo(a.lastRunAt)}` : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditTarget(a)}>Edit</Button>
                <Button size="sm" variant="outline" onClick={() => setRunTarget(a)}>Run</Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {runTarget && (
        <Modal open onClose={() => setRunTarget(null)} title={`Run ${runTarget.name}`}>
          {runTarget.kind === "portfolio_monitor" ? (
            <div className="space-y-3">
              <p className="text-xs text-paper-500">Portfolio-wide sweep across all companies with portfolio status.</p>
              <RunNowButton agentId={runTarget.id} onDone={() => { setRunTarget(null); qc.invalidateQueries({ queryKey: ["automations-overview"] }); }} />
            </div>
          ) : (
            <CompanyPickForm
              onSubmit={(companyId) =>
                api.post(`/agents/${runTarget.id}/runs`, { companyId }).then(() => {
                  setRunTarget(null);
                  qc.invalidateQueries({ queryKey: ["automations-overview"] });
                })
              }
              submitLabel={runTarget.kind === "diligence_checklist" ? "Provision checklist" : "Screen"}
            />
          )}
        </Modal>
      )}

      {editTarget && <AgentModal initial={editTarget} onClose={() => setEditTarget(null)} />}
      {!editTarget && (
        <button
          onClick={() => setEditTarget({ ...blankAgent })}
          className="fixed bottom-6 right-6 z-30 flex h-11 items-center gap-1.5 rounded-full border border-paper-900/[0.12] bg-white px-4 text-sm font-medium text-paper-700 shadow-lg transition hover:border-brand-500/40 hover:text-brand-700"
        >
          <IconPlus width={14} height={14} /> New agent
        </button>
      )}
    </>
  );
}

function CompanyPickForm({ onSubmit, submitLabel }: { onSubmit: (companyId: string) => Promise<unknown>; submitLabel: string }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
  const companiesQ = useQuery({
    queryKey: ["companies", q],
    queryFn: () => {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      params.set("limit", "8");
      return api.get<{ items: Array<{ id: string; name: string }> }>(`/companies?${params}`);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (selected) void onSubmit(selected.id);
      }}
      className="space-y-3"
    >
      <Field label="Company">
        <input
          className={inputCls}
          placeholder="Search companies…"
          value={selected?.name ?? q}
          onChange={(e) => { setSelected(null); setQ(e.target.value); }}
        />
        {!selected && q.length > 0 && !!companiesQ.data?.items.length && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-paper-900/[0.12] bg-white">
            {companiesQ.data.items.map((c) => (
              <button
                type="button"
                key={c.id}
                className="block w-full px-3 py-2 text-left text-sm text-paper-900 hover:bg-brand-50"
                onClick={() => setSelected(c)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={!selected}>
          {selected ? submitLabel : "Pick a company"}
        </Button>
      </div>
    </form>
  );
}

function RunNowButton({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const run = useMutation({ mutationFn: () => api.post(`/agents/${agentId}/runs`, {}), onSuccess: onDone });
  return (
    <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
      {run.isPending ? <Spinner /> : "Run now"}
    </Button>
  );
}

function AgentModal({ initial, onClose }: { initial?: Agent; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial && initial.id ? api.patch(`/agents/${initial.id}`, body) : api.post("/agents", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations-overview"] });
      onClose();
    },
  });

  const keywords = initial?.config?.mustHaveKeywords?.join(", ") ?? "";

  return (
    <Modal open onClose={onClose} title={initial && initial.id ? `Edit ${initial.name}` : "New agent"}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          save.mutate({
            name: String(fd.get("name") ?? ""),
            kind: String(fd.get("kind") ?? "thesis_screen"),
            description: String(fd.get("description") ?? "") || undefined,
            instructions: String(fd.get("instructions") ?? "") || undefined,
            config: {
              ...(initial?.config ?? {}),
              mustHaveKeywords: String(fd.get("keywords") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
            },
          });
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <input name="name" required autoFocus defaultValue={initial?.name} className={inputCls} placeholder="Climate Infra Screener" />
        </Field>
        <Field label="Kind">
          <select name="kind" defaultValue={initial?.kind || "thesis_screen"} disabled={!!initial?.isSystem} className={inputCls}>
            <option value="thesis_screen">Thesis screen</option>
            <option value="diligence_checklist">Diligence checklist</option>
            <option value="portfolio_monitor">Portfolio monitor</option>
            <option value="custom">Custom</option>
          </select>
        </Field>
        <Field label="Description"><input name="description" defaultValue={initial?.description ?? ""} className={inputCls} placeholder="What this agent owns" /></Field>
        <Field label="Instructions / thesis" hint="The judgment this agent applies every time">
          <textarea name="instructions" rows={3} defaultValue={initial?.instructions ?? ""} className={inputCls} placeholder="We back infrastructure-software businesses at Series A/B in North America…" />
        </Field>
        <Field label="Must-have keywords" hint="Comma-separated; each hit raises fit">
          <input name="keywords" defaultValue={keywords} className={inputCls} placeholder="infrastructure, b2b, recurring revenue" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm">{save.isPending ? <Spinner /> : initial && initial.id ? "Save changes" : "Create"}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Workflows tab — visual flow canvas ────────────────────────────── */

type FlowKind = "when" | "if" | "and" | "then";

const FLOW_STYLE: Record<FlowKind, { chip: string; border: string; icon: string }> = {
  when: { chip: "border-brand-200 bg-brand-50 text-brand-700", border: "border-l-brand-500", icon: "⚡" },
  if: { chip: "border-purple-200 bg-purple-50 text-purple-700", border: "border-l-purple-500", icon: "◆" },
  and: { chip: "border-purple-200 bg-purple-50 text-purple-700", border: "border-l-purple-500", icon: "◆" },
  then: { chip: "border-emerald-200 bg-emerald-50 text-emerald-700", border: "border-l-emerald-500", icon: "▶" },
};

function FlowLine() {
  return (
    <div className="flex h-5 shrink-0 justify-center">
      <div className="w-px bg-paper-900/20" />
    </div>
  );
}

function FlowBlock({
  kind,
  title,
  removable,
  onRemove,
  children,
}: {
  kind: FlowKind;
  title?: string;
  removable?: boolean;
  onRemove?: () => void;
  children: ReactNode;
}) {
  const st = FLOW_STYLE[kind];
  return (
    <div className={cx2("rounded-lg border border-paper-900/[0.1] border-l-[3px] bg-white p-2.5 shadow-card", st.border)}>
      <div className="flex items-center gap-2">
        <span className={cx2("rounded border px-1.5 py-px font-mono text-[9px] font-bold uppercase tracking-wider", st.chip)}>
          {st.icon} {title ?? kind}
        </span>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove step"
            className="ml-auto text-xs leading-none text-paper-300 hover:text-red-500"
          >
            ✕
          </button>
        )}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function prettyEvent(t: string): string {
  return t.replace(/_/g, " ");
}

function summarizeAction(a: { type: string; config: Record<string, unknown> }): string {
  const c = a.config ?? {};
  switch (a.type) {
    case "add_note": return `"${String(c.body ?? "").slice(0, 60)}"`;
    case "move_deal": return `to ${String(c.stageName ?? "?")}`;
    case "run_agent": return `dispatch "${String(c.agentName ?? c.agentId ?? "?")}"`;
    case "set_deal_fields":
    case "set_company_fields": return Object.keys((c.fields ?? {}) as object).join(", ") || "(fields)";
    case "create_portfolio_update": return String(c.title ?? "").slice(0, 50);
    default: return "";
  }
}

/** Read-only connected flow rendered on each workflow card. */
function MiniFlow({ w }: { w: Workflow }) {
  return (
    <div className="mt-3 max-w-md">
      <FlowBlock kind="when" title="when">
        <p className="text-xs font-semibold capitalize text-paper-900">{prettyEvent(w.triggerEvent)}</p>
      </FlowBlock>
      {w.conditions.map((c, i) => (
        <div key={`c${i}`}>
          <FlowLine />
          <FlowBlock kind={i === 0 ? "if" : "and"} title={i === 0 ? "if" : "and"}>
            <p className="truncate font-mono text-[11px] text-paper-700">
              {c.field} <span className="text-paper-400">{c.op}</span> {c.op === "exists" ? "" : String(c.value ?? "")}
            </p>
          </FlowBlock>
        </div>
      ))}
      {w.actions.map((a, i) => (
        <div key={`a${i}`}>
          <FlowLine />
          <FlowBlock kind="then" title={i === 0 ? "then" : "and"}>
            <p className="text-xs font-medium text-paper-900">{prettyEvent(a.type)}</p>
            {summarizeAction(a) && <p className="truncate text-[11px] text-paper-500">{summarizeAction(a)}</p>}
          </FlowBlock>
        </div>
      ))}
    </div>
  );
}

function WorkflowsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  const qc = useQueryClient();
  const [canvasTarget, setCanvasTarget] = useState<Workflow | "new" | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["automations-overview"] });

  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.patch(`/workflows/${id}`, { isEnabled }),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post<Record<string, unknown>>(`/workflows/${id}/test`, {}),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: invalidate,
  });

  if (overviewQ.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (!overviewQ.data?.workflows.length) {
    return (
      <EmptyState
        icon={<IconSpark width={20} height={20} />}
        title="No workflows yet"
        hint="WHEN something happens IF conditions match THEN act — including dispatching an agent."
      />
    );
  }

  return (
    <div className="space-y-3">
      {overviewQ.data.workflows.map((w) => {
        const testResult = w.id === test.variables ? (test.data as Record<string, unknown> | undefined) : undefined;
        return (
          <div key={w.id} className="panel p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-paper-900">{w.name}</span>
                  <Badge tone={w.isEnabled ? "green" : "slate"}>{w.isEnabled ? "enabled" : "disabled"}</Badge>
                </div>
                {w.description && <p className="mt-0.5 text-xs text-paper-500">{w.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="xs" variant="ghost" onClick={() => setCanvasTarget(w)}>Edit</Button>
                <Button size="xs" variant="outline" onClick={() => test.mutate(w.id)} disabled={test.isPending}>
                  Test
                </Button>
                <Button size="xs" variant="outline" onClick={() => toggle.mutate({ id: w.id, isEnabled: !w.isEnabled })}>
                  {w.isEnabled ? "Disable" : "Enable"}
                </Button>
                <button
                  className="rounded p-1 text-xs text-paper-400 hover:bg-red-50 hover:text-red-600"
                  onClick={() => del.mutate(w.id)}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* the flow itself, as connected blocks */}
            <MiniFlow w={w} />

            <div className="mt-2.5 flex items-center gap-3 text-[11px] text-paper-400">
              <span>{w.runCount} run{w.runCount === 1 ? "" : "s"}</span>
              {w.lastRunAt && <span>last {timeAgo(w.lastRunAt)}</span>}
            </div>

            {testResult !== undefined && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-paper-900/[0.08] bg-paper-50 p-2 font-mono text-[10px] text-paper-600">
                {testResult.note ? String(testResult.note) + "\n" : ""}{JSON.stringify(testResult.steps ?? testResult, null, 2).slice(0, 600)}
              </pre>
            )}
          </div>
        );
      })}

      <button
        onClick={() => setCanvasTarget("new")}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-paper-900/[0.18] py-3 text-sm font-medium text-paper-500 transition hover:border-brand-500/40 hover:text-brand-700"
      >
        <IconPlus width={14} height={14} /> New workflow — WHEN something happens THEN act
      </button>

      {canvasTarget && (
        <WorkflowCanvasModal initial={canvasTarget === "new" ? undefined : canvasTarget} onClose={() => setCanvasTarget(null)} />
      )}
    </div>
  );
}

interface CondDraft {
  field: string;
  op: string;
  value: string;
}
interface ActionDraft {
  type: string;
  config: Record<string, unknown>;
}

const TRIGGER_OPTIONS = [
  "deal.created",
  "deal.stage_changed",
  "deal.updated",
  "company.created",
  "company.updated",
  "email.processed",
  "email.needs_review",
  "document.parsed",
  "extraction.completed",
  "note.added",
  "portfolio_update.created",
  "agent_run.completed",
];

/** Visual block builder — WHEN → IF gates → THEN actions, connected. */
function WorkflowCanvasModal({ initial, onClose }: { initial?: Workflow; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api.patch(`/workflows/${initial.id}`, body) : api.post("/workflows", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations-overview"] });
      onClose();
    },
  });

  /** stored action config → editor draft fields */
  const actionToDraft = (a: Workflow["actions"][number]): ActionDraft => {
    switch (a.type) {
      case "add_note": return { type: a.type, config: { body: String(a.config.body ?? "") } };
      case "move_deal": return { type: a.type, config: { stageName: String(a.config.stageName ?? "") } };
      case "run_agent": return { type: a.type, config: { agentName: String(a.config.agentName ?? "") } };
      case "create_portfolio_update": return { type: a.type, config: { title: String(a.config.title ?? "") } };
      case "set_deal_fields":
      case "set_company_fields": {
        const fields = (a.config.fields ?? {}) as Record<string, unknown>;
        return {
          type: a.type,
          config: {
            fieldsText: Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join(", "),
          },
        };
      }
      default: return { type: a.type, config: {} };
    }
  };

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [triggerEvent, setTriggerEvent] = useState(initial?.triggerEvent ?? "deal.created");
  const [conditions, setConditions] = useState<CondDraft[]>(
    (initial?.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: c.op === "exists" ? "" : String(c.value ?? "") })),
  );
  const [actions, setActions] = useState<ActionDraft[]>(
    initial?.actions.length ? initial.actions.map(actionToDraft) : [{ type: "add_note", config: { body: "" } }],
  );

  const updateCond = (i: number, patch: Partial<CondDraft>) =>
    setConditions(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const updateAction = (i: number, patch: Partial<ActionDraft>) =>
    setActions(actions.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const submit = () => {
    save.mutate({
      name,
      description: description || undefined,
      triggerEvent,
      conditions: conditions
        .filter((c) => c.field)
        .map((c) => ({
          field: c.field,
          op: c.op,
          value: c.op === "exists" ? undefined : c.value,
        })),
      actions: actions.map((a) => ({
        type: a.type,
        config:
          a.type === "add_note" ? { body: String(a.config.body ?? "") } :
          a.type === "move_deal" ? { stageName: String(a.config.stageName ?? "") } :
          a.type === "run_agent" ? { agentName: String(a.config.agentName ?? "") } :
          a.type === "create_portfolio_update" ? { title: String(a.config.title ?? "") } :
          {
            fields: Object.fromEntries(
              String(a.config.fieldsText ?? "")
                .split(",")
                .filter(Boolean)
                .map((pair) => {
                  const eq = pair.indexOf("=");
                  return eq < 0 ? [pair.trim(), ""] : [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
                }),
            ),
          },
      })),
      isEnabled: true,
    });
  };

  return (
    <Modal open onClose={onClose} title={initial ? `Edit ${initial.name}` : "Design an automation"} wide>
      <div className="space-y-4">
        <Field label="Name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Advance winners automatically" />
        </Field>
        <Field label="Description">
          <input className={inputCls} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this automation owns" />
        </Field>

        {/* canvas */}
        <div className="rounded-xl border border-paper-900/[0.09] bg-paper-100/60 p-4">
          <FlowBlock kind="when" title="when">
            <select className={`${inputCls} capitalize`} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)}>
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t} value={t}>{prettyEvent(t)}</option>
              ))}
            </select>
          </FlowBlock>

          {conditions.map((c, i) => (
            <div key={`c${i}`}>
              <FlowLine />
              <FlowBlock
                kind={i === 0 ? "if" : "and"}
                title={i === 0 ? "if" : "and"}
                removable
                onRemove={() => setConditions(conditions.filter((_, j) => j !== i))}
              >
                <div className="flex gap-1.5">
                  <input
                    className={`${inputCls} min-w-0 flex-1`}
                    placeholder="snapshot path e.g. output.recommendation"
                    value={c.field}
                    onChange={(e) => updateCond(i, { field: e.target.value })}
                  />
                  <select className={`${inputCls} w-24`} value={c.op} onChange={(e) => updateCond(i, { op: e.target.value })}>
                    {["eq", "neq", "contains", "gt", "gte", "lt", "lte", "exists"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                  {c.op !== "exists" && (
                    <input
                      className={`${inputCls} w-28`}
                      placeholder="value"
                      value={c.value}
                      onChange={(e) => updateCond(i, { value: e.target.value })}
                    />
                  )}
                </div>
              </FlowBlock>
            </div>
          ))}
          <div className="py-1.5 text-center">
            <button
              type="button"
              className="rounded-full border border-purple-200 bg-purple-50 px-2.5 py-1 text-[11px] font-medium text-purple-700 transition hover:bg-purple-100"
              onClick={() => setConditions([...conditions, { field: "", op: "eq", value: "" }])}
            >
              + if condition
            </button>
          </div>

          <FlowLine />

          {actions.map((a, i) => (
            <div key={`a${i}`}>
              <FlowBlock
                kind="then"
                title={i === 0 ? "then" : "and"}
                removable
                onRemove={() => setActions(actions.filter((_, j) => j !== i))}
              >
                <div className="flex gap-1.5">
                  <select
                    className={`${inputCls} w-44`}
                    value={a.type}
                    onChange={(e) => updateAction(i, { type: e.target.value, config: {} })}
                  >
                    {["add_note", "move_deal", "set_deal_fields", "set_company_fields", "create_portfolio_update", "run_agent"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  {a.type === "add_note" && (
                    <input
                      className={`${inputCls} min-w-0 flex-1`}
                      placeholder="note body — {{company.name}} works"
                      value={String(a.config.body ?? "")}
                      onChange={(e) => updateAction(i, { config: { ...a.config, body: e.target.value } })}
                    />
                  )}
                  {a.type === "move_deal" && (
                    <input
                      className={`${inputCls} min-w-0 flex-1`}
                      placeholder="stage name e.g. Initial Review"
                      value={String(a.config.stageName ?? "")}
                      onChange={(e) => updateAction(i, { config: { ...a.config, stageName: e.target.value } })}
                    />
                  )}
                  {a.type === "run_agent" && (
                    <input
                      className={`${inputCls} min-w-0 flex-1`}
                      placeholder="agent name e.g. Thesis Screener"
                      value={String(a.config.agentName ?? "")}
                      onChange={(e) => updateAction(i, { config: { ...a.config, agentName: e.target.value } })}
                    />
                  )}
                  {(a.type === "set_deal_fields" || a.type === "set_company_fields") && (
                    <input
                      className={`${inputCls} min-w-0 flex-1`}
                      placeholder="key=value, key2=value2"
                      value={String(a.config.fieldsText ?? "")}
                      onChange={(e) => updateAction(i, { config: { ...a.config, fieldsText: e.target.value } })}
                    />
                  )}
                  {a.type === "create_portfolio_update" && (
                    <input
                      className={`${inputCls} min-w-0 flex-1`}
                      placeholder="title"
                      value={String(a.config.title ?? "")}
                      onChange={(e) => updateAction(i, { config: { ...a.config, title: e.target.value } })}
                    />
                  )}
                </div>
              </FlowBlock>
              <FlowLine />
            </div>
          ))}
          <div className="text-center">
            <button
              type="button"
              className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 transition hover:bg-emerald-100"
              onClick={() => setActions([...actions, { type: "add_note", config: { body: "" } }])}
            >
              + then action
            </button>
          </div>
        </div>

        <p className="rounded-lg bg-paper-100 px-3 py-2 text-[11px] leading-relaxed text-paper-500">
          React to finished agents by triggering on{" "}
          <code className="font-mono">agent_run.completed</code> and gating on{" "}
          <code className="font-mono">output.recommendation eq advance</code>. Use{" "}
          <code className="font-mono">run_agent</code> to dispatch judgment mid-flow. Self-chains are blocked automatically.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || save.isPending} onClick={submit}>
            {save.isPending ? <Spinner /> : initial ? "Save changes" : "Create workflow"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
/* ── Runs tab ──────────────────────────────────────────────────────── */

function RunsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  if (overviewQ.isLoading) return <Skeleton className="h-48 w-full" />;
  if (!overviewQ.data?.runs.length) {
    return (
      <EmptyState
        icon={<IconSpark width={20} height={20} />}
        title="No runs yet"
        hint="Agent executions and workflow fires appear here together."
      />
    );
  }

  return (
    <div className="panel divide-y divide-paper-900/[0.06]">
      {overviewQ.data.runs.map((r) => (
        <div key={`${r.source}-${r.id}`} className="py-2.5 first:pt-3 last:pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <StatusDot status={r.status} />
              <Badge tone={r.source === "agent" ? "indigo" : "purple"}>{r.source}</Badge>
              <span className="truncate text-sm font-medium text-paper-900">{r.name}</span>
              {r.trigger && r.source === "workflow" && (
                <span className="hidden shrink-0 font-mono text-[10px] text-paper-400 md:inline">via {r.trigger.replace(/_/g, " ")}</span>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-paper-400">{timeAgo(r.createdAt)}</span>
          </div>
          {r.summary && <p className="mt-0.5 pl-[52px] line-clamp-2 text-xs text-paper-500">{r.summary}</p>}
        </div>
      ))}
    </div>
  );
}
