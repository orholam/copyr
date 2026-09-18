import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Badge, PageHeader, Panel, Skeleton } from "../../components/ui";
import { IconChart, IconSpark, IconTrendUp } from "../../components/icons";

interface CommandCenterReport {
  adoption: {
    deals: number;
    companies: number;
    documentsParsed: number;
    vaults: number;
    reviewTables: number;
    reviewRowsExtracted: number;
    activeAgents: number;
    agentRunsCompleted: number;
    agentRunsFailed: number;
    scheduledAgents: number;
    spaces: number;
    openTasks: number;
    memories: number;
    researchReports: number;
  };
  activity30d: {
    total: number;
    byActor: { user: number; ai: number; system: number };
    aiLeveragePct: number;
    topEventTypes: Array<{ type: string; count: number }>;
  };
  credits30d: {
    spent: number;
    granted: number;
    balance: number;
    byReason: Array<{ reason: string; amount: number }>;
  };
  benchmark: {
    workspaceCount: number;
    dealsPercentile: number;
    documentsPercentile: number;
    pctWorkspacesUsingVaults: number;
    pctWorkspacesUsingAgents: number;
    pctWorkspacesUsingResearch: number;
    thisWorkspaceUses: string[];
  };
  recommendations: string[];
}

export default function CommandCenter() {
  const q = useQuery({
    queryKey: ["command-center"],
    queryFn: () => api.get<CommandCenterReport>("/command-center"),
    refetchInterval: 15_000,
  });

  if (q.isLoading) {
    return (
      <div className="animate-fade-up space-y-4">
        <PageHeader title="Command Center" subtitle="Steer your AI transformation" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  const r = q.data;
  if (!r) return null;

  const actorTotal = Math.max(1, r.activity30d.total);

  return (
    <div className="animate-fade-up space-y-5">
      <PageHeader
        title="Command Center"
        subtitle={`Adoption, benchmarking and next moves · compared against ${r.benchmark.workspaceCount} workspace${r.benchmark.workspaceCount === 1 ? "" : "s"} on this deployment`}
      />

      {/* adoption grid */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-paper-900/[0.09] bg-paper-200/70 md:grid-cols-4">
        <Stat label="Deals live" value={r.adoption.deals} />
        <Stat label="Docs parsed" value={r.adoption.documentsParsed} />
        <Stat label="Agent runs" value={r.adoption.agentRunsCompleted} sub={`${r.adoption.agentRunsFailed} failed`} />
        <Stat label="Review rows extracted" value={r.adoption.reviewRowsExtracted} />
        <Stat label="Active agents" value={r.adoption.activeAgents} sub={`${r.adoption.scheduledAgents} scheduled`} />
        <Stat label="Open tasks" value={r.adoption.openTasks} />
        <Stat label="Research reports" value={r.adoption.researchReports} />
        <Stat label="Memories" value={r.adoption.memories} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Who does the work" icon={<IconTrendUp width={13} height={13} />}>
          <p className="text-xs text-paper-500">Events in the last 30 days by actor — the AI leverage ratio.</p>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-paper-100">
            <div className="bg-brand-500 transition-all duration-700" style={{ width: `${(r.activity30d.byActor.ai / actorTotal) * 100}%` }} />
            <div className="bg-emerald-500/80 transition-all duration-700" style={{ width: `${(r.activity30d.byActor.user / actorTotal) * 100}%` }} />
            <div className="bg-paper-200 transition-all duration-700" style={{ width: `${(r.activity30d.byActor.system / actorTotal) * 100}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-paper-600">
            <Legend color="bg-brand-500" label={`AI ${r.activity30d.byActor.ai}`} />
            <Legend color="bg-emerald-500/80" label={`Humans ${r.activity30d.byActor.user}`} />
            <Legend color="bg-paper-200" label={`System ${r.activity30d.byActor.system}`} />
          </div>
          <div className="mt-4 rounded-md border border-brand-200 bg-brand-50 px-3 py-2 text-xs font-semibold text-brand-800">
            AI produced {r.activity30d.aiLeveragePct}% of tracked activity
          </div>
        </Panel>

        <Panel title="Peer benchmarks" icon={<IconChart width={13} height={13} />}>
          <div className="space-y-3">
            <BenchBar label="Deal volume percentile" pct={r.benchmark.dealsPercentile} />
            <BenchBar label="Document corpus percentile" pct={r.benchmark.documentsPercentile} />
            <BenchBar label="Workspaces using vaults" pct={r.benchmark.pctWorkspacesUsingVaults} muted />
            <BenchBar label="Workspaces using agents" pct={r.benchmark.pctWorkspacesUsingAgents} muted />
            <BenchBar label="Workspaces using research" pct={r.benchmark.pctWorkspacesUsingResearch} muted />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {r.benchmark.thisWorkspaceUses.map((u) => (
              <Badge key={u} tone="indigo">{u}</Badge>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Credit economics (30d)" icon={<IconSpark width={13} height={13} />}>
          <div className="flex items-baseline justify-between">
            <span className="num text-xl font-medium tracking-[-0.01em] text-paper-900">{r.credits30d.spent.toLocaleString()}</span>
            <span className="text-[11px] text-paper-500">balance {r.credits30d.balance.toLocaleString()}</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {r.credits30d.byReason.map((c) => (
              <div key={c.reason} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-paper-600">{c.reason.replace(/_/g, " ")}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper-100">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${Math.max(4, (c.amount / Math.max(1, r.credits30d.spent)) * 100)}%` }}
                  />
                </div>
                <span className="num w-10 text-right text-paper-500">{c.amount}</span>
              </div>
            ))}
            {!r.credits30d.byReason.length && <p className="text-xs text-paper-500">No spend recorded yet.</p>}
          </div>
        </Panel>

        <Panel title="Recommended next moves" icon={<IconSpark width={13} height={13} />}>
          <ol className="space-y-2.5">
            {r.recommendations.map((rec, i) => (
              <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-paper-700">
                <span className="btn-ink mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-paper-50">
                  {i + 1}
                </span>
                {rec}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      {!!r.activity30d.topEventTypes.length && (
        <Panel title="Top activity streams (30d)">
          <div className="flex flex-wrap gap-2">
            {r.activity30d.topEventTypes.map((t) => (
              <Badge key={t.type} tone="slate">
                {t.type} · {t.count}
              </Badge>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-xs text-paper-500">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="num text-[22px] font-medium leading-none tracking-[-0.01em] text-paper-900">
          {value.toLocaleString()}
        </span>
        {sub && <span className="text-[11px] text-paper-500">{sub}</span>}
      </div>
    </div>
  );
}

function BenchBar({ label, pct, muted }: { label: string; pct: number; muted?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-paper-600">{label}</span>
        <span className="num font-semibold text-paper-800">{pct}th</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper-100">
        <div
          className={`h-full rounded-full ${muted ? "bg-paper-300" : "bg-brand-600"}`}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${color}`} />
      {label}
    </span>
  );
}
