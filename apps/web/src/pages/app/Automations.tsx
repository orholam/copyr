import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
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
import { WorkflowMiniCanvas } from "./WorkflowBuilder";
import { WORKFLOW_USE_CASES } from "./workflowUseCases";
import { WorkflowEditorModal, type WorkflowRecord } from "./WorkflowEditorModal";

export { WORKFLOW_USE_CASES } from "./workflowUseCases";

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

type Workflow = WorkflowRecord & {
  runCount: number;
  lastRunAt: string | null;
};

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
        subtitle="Agents, workflow runs, and ops — design flows on the Workflows board"
        actions={
          <Link
            to="/app/workflows"
            className="flex h-8 items-center rounded-md border border-paper-900/[0.14] bg-white px-3 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
          >
            Open workflows board
          </Link>
        }
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

function WorkflowsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  const qc = useQueryClient();
  const [canvasTarget, setCanvasTarget] = useState<Workflow | "new" | null>(null);
  const existingNames = new Set((overviewQ.data?.workflows ?? []).map((w) => w.name));

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
  const install = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/workflows", body),
    onSuccess: invalidate,
  });
  const installAllMissing = useMutation({
    mutationFn: async () => {
      const missing = WORKFLOW_USE_CASES.filter((u) => !existingNames.has(u.name));
      for (const u of missing) {
        await api.post("/workflows", {
          name: u.name,
          description: u.blurb,
          triggerEvent: u.triggerEvent,
          conditions: u.conditions,
          actions: u.actions,
          isEnabled: true,
        });
      }
      return missing.length;
    },
    onSuccess: invalidate,
  });

  if (overviewQ.isLoading) {
    return <Skeleton className="h-32 w-full" />;
  }

  const useCaseStrip = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-paper-400">Use cases</p>
        {WORKFLOW_USE_CASES.some((u) => !existingNames.has(u.name)) && (
          <Button
            size="xs"
            variant="outline"
            disabled={installAllMissing.isPending}
            onClick={() => installAllMissing.mutate()}
          >
            {installAllMissing.isPending ? <Spinner /> : "Install all"}
          </Button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {WORKFLOW_USE_CASES.map((u) => {
          const installed = existingNames.has(u.name);
          return (
            <div
              key={u.name}
              className="flex items-start justify-between gap-2 rounded-xl border border-paper-900/[0.08] bg-paper-50/80 px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-paper-900">{u.name}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-paper-500">{u.blurb}</p>
              </div>
              {installed ? (
                <Badge tone="green">on</Badge>
              ) : (
                <Button
                  size="xs"
                  disabled={install.isPending}
                  onClick={() =>
                    install.mutate({
                      name: u.name,
                      description: u.blurb,
                      triggerEvent: u.triggerEvent,
                      conditions: u.conditions,
                      actions: u.actions,
                      isEnabled: true,
                    })
                  }
                >
                  Add
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!overviewQ.data?.workflows.length) {
    return (
      <div className="space-y-4">
        {useCaseStrip}
        <EmptyState
          icon={<IconSpark width={20} height={20} />}
          title="No workflows yet"
          hint="Install a use case above, or open a blank canvas and drag nodes onto the dotted board."
          action={
            <Button size="sm" onClick={() => setCanvasTarget("new")}>
              <IconPlus width={14} height={14} /> Blank canvas
            </Button>
          }
        />
        {canvasTarget && (
          <WorkflowEditorModal
            initial={canvasTarget === "new" ? undefined : canvasTarget}
            onClose={() => setCanvasTarget(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {useCaseStrip}

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

              <WorkflowMiniCanvas
                triggerEvent={w.triggerEvent}
                conditionCount={w.conditions.length}
                actionLabels={w.actions.map((a) => a.type)}
              />

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
          <IconPlus width={14} height={14} /> New workflow — open the visual canvas
        </button>
      </div>

      {canvasTarget && (
        <WorkflowEditorModal
          initial={canvasTarget === "new" ? undefined : canvasTarget}
          onClose={() => setCanvasTarget(null)}
        />
      )}
    </div>
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
