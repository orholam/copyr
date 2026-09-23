/**
 * Agents page — judgment engines (screeners, checklists, monitors) + their run history.
 * Event rules live on /app/workflows — keep these surfaces separate on purpose.
 */
import { useState } from "react";
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
  workflows: Array<{ id: string; isEnabled: boolean }>;
  runs: RunItem[];
  stats: { activeAgents: number; enabledWorkflows: number; runsLast7d: number; chainRunsLast7d: number };
}

const KIND_LABEL: Record<string, string> = {
  thesis_screen: "Thesis screen",
  diligence_checklist: "Checklist builder",
  portfolio_monitor: "Portfolio monitor",
  custom: "Custom",
};

const KIND_HINT: Record<string, string> = {
  thesis_screen: "Scores a company and recommends advance / watch / pass",
  diligence_checklist: "Creates open diligence tasks on a company space",
  portfolio_monitor: "Summarizes recent portfolio activity",
  custom: "Custom instructions",
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
  const [tab, setTab] = useState<"agents" | "runs">("agents");

  const overviewQ = useQuery({
    queryKey: ["automations-overview"],
    queryFn: () => api.get<Overview>("/automations/overview"),
    refetchInterval: 8000,
  });

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Agents"
        subtitle="Judgment engines that screen companies, build diligence checklists, and monitor the portfolio. Event rules that call them live on Workflows."
        actions={
          <Link
            to="/app/workflows"
            className="flex h-8 items-center rounded-md border border-paper-900/[0.14] bg-white px-3 text-xs font-medium text-paper-800 transition hover:bg-paper-100"
          >
            Open Workflows
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
        <Stat label="Active agents" value={overviewQ.data?.stats.activeAgents ?? 0} />
        <Stat label="Runs (7d)" value={overviewQ.data?.stats.runsLast7d ?? 0} />
      </div>

      <SegmentedControl
        value={tab}
        onChange={(v) => setTab(v as typeof tab)}
        options={[
          { value: "agents", label: `Agents (${overviewQ.data?.agents.length ?? 0})` },
          { value: "runs", label: "Recent runs" },
        ]}
      />

      {tab === "agents" && <AgentsTab overviewQ={overviewQ} />}
      {tab === "runs" && <RunsTab overviewQ={overviewQ} />}
    </div>
  );
}

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
    status === "completed"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : status === "running"
          ? "bg-amber-500 animate-pulse"
          : "bg-paper-300";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function AgentsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  const qc = useQueryClient();
  const [runTarget, setRunTarget] = useState<Agent | null>(null);
  const [editTarget, setEditTarget] = useState<Agent | null>(null);

  if (overviewQ.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full" />
        ))}
      </div>
    );
  }
  if (!overviewQ.data?.agents.length) {
    return (
      <EmptyState
        icon={<IconBot width={20} height={20} />}
        title="No agents yet"
        hint="Agents are judgment engines — thesis screens, checklists, monitors — that workflows can call."
      />
    );
  }

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {overviewQ.data.agents.map((a) => (
          <div key={a.id} className="panel flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-paper-900">{a.name}</span>
                  <Badge tone="indigo">{KIND_LABEL[a.kind] ?? a.kind}</Badge>
                  {!a.isActive && <Badge tone="slate">off</Badge>}
                </div>
                <p className="mt-1 text-[11px] text-paper-500">{KIND_HINT[a.kind]}</p>
                {a.description && <p className="mt-1 text-xs text-paper-600">{a.description}</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Button size="xs" onClick={() => setRunTarget(a)}>
                Run now
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setEditTarget(a)}>
                Edit
              </Button>
              <span className="ml-auto text-[11px] text-paper-400">
                {a.runCount} runs
                {a.lastRunAt ? ` · ${timeAgo(a.lastRunAt)}` : ""}
              </span>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setEditTarget(blankAgent)}
          className="flex min-h-[120px] items-center justify-center gap-1.5 rounded-xl border border-dashed border-paper-900/[0.18] text-sm font-medium text-paper-500 transition hover:border-brand-500/40 hover:text-brand-700"
        >
          <IconPlus width={14} height={14} /> New agent
        </button>
      </div>

      {runTarget && (
        <Modal open onClose={() => setRunTarget(null)} title={`Run ${runTarget.name}`}>
          <p className="mb-3 text-sm text-paper-600">
            Runs this agent once against a company. For automatic runs on stage changes, add a rule on Workflows.
          </p>
          <RunAgentForm agentId={runTarget.id} onDone={() => setRunTarget(null)} />
        </Modal>
      )}
      {editTarget && <AgentModal initial={editTarget.id ? editTarget : undefined} onClose={() => setEditTarget(null)} />}
    </>
  );
}

function RunAgentForm({ agentId, onDone }: { agentId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const run = useMutation({
    mutationFn: () => api.post(`/agents/${agentId}/runs`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations-overview"] });
      onDone();
    },
  });
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
              mustHaveKeywords: String(fd.get("keywords") ?? "")
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
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
        <Field label="Description">
          <input name="description" defaultValue={initial?.description ?? ""} className={inputCls} placeholder="What this agent owns" />
        </Field>
        <Field label="Instructions / thesis" hint="The judgment this agent applies every time">
          <textarea
            name="instructions"
            rows={3}
            defaultValue={initial?.instructions ?? ""}
            className={inputCls}
            placeholder="We back infrastructure-software businesses at Series A/B…"
          />
        </Field>
        <Field label="Must-have keywords" hint="Comma-separated; each hit raises fit">
          <input name="keywords" defaultValue={keywords} className={inputCls} placeholder="infrastructure, b2b" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            {save.isPending ? <Spinner /> : initial && initial.id ? "Save changes" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RunsTab({ overviewQ }: { overviewQ: { data?: Overview; isLoading: boolean } }) {
  if (overviewQ.isLoading) return <Skeleton className="h-48 w-full" />;
  if (!overviewQ.data?.runs.length) {
    return (
      <EmptyState
        icon={<IconSpark width={20} height={20} />}
        title="No runs yet"
        hint="Every agent execution shows up here — what ran and what it produced."
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
              <Badge tone={r.source === "agent" ? "indigo" : "purple"}>
                {r.source === "agent" ? "agent" : "workflow"}
              </Badge>
              <span className="truncate text-sm font-medium text-paper-900">{r.name}</span>
            </div>
            <span className="shrink-0 text-[11px] text-paper-400">{timeAgo(r.createdAt)}</span>
          </div>
          {r.summary && (
            <p className="mt-0.5 pl-[52px] line-clamp-2 text-xs text-paper-500">{r.summary}</p>
          )}
        </div>
      ))}
    </div>
  );
}
