import { useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../../lib/api";
import { DeltaChip, ErrorState, PageHeader, Skeleton, money } from "../../components/ui";

interface Breakdown {
  count: number;
  usd: number;
}

interface Overview {
  activeDeals: number;
  activeDealsDeltaPct: number;
  totalPipelineUsd: number;
  totalPipelineDeltaPct: number;
  newFounders30d: number;
  newFoundersDeltaPct: number;
  conversionRatePct: number;
  conversionDeltaPct: number;
  openDeals: number;
  wonDeals: number;
  lostDeals: number;
  avgAskUsd: number;
  medianAskUsd: number;
  byStage: Array<Breakdown & { stageId: string; stageName: string; color: string }>;
  weeklyIngestion: Array<{ weekStart: string; deals: number; usd: number }>;
  bySector: Array<Breakdown & { name: string }>;
  bySource: Array<Breakdown & { source: string }>;
  byRound: Array<Breakdown & { round: string }>;
  byOwner: Array<Breakdown & { ownerId: string | null; name: string }>;
  largestDeals: Array<{
    id: string;
    name: string;
    sector: string | null;
    roundStage: string | null;
    askAmount: number | null;
    stageName: string;
    stageColor: string;
  }>;
}

const TOOLTIP_STYLE = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--paper-900) / 0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--paper-800))",
  boxShadow: "0 8px 24px -8px rgba(0,0,0,.3)",
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "Manual",
  email: "Email",
  upload: "Upload",
  link: "Link",
  form: "Form",
  api: "API",
  agent: "Agent",
  seed: "Seed",
};

function CaptionBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-paper-900/[0.07] bg-paper-100/70 px-3.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-paper-600">{title}</p>
      {right}
    </div>
  );
}

export default function Analytics() {
  const funnelRef = useRef<HTMLDivElement>(null);
  const overviewQ = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api.get<Overview>("/analytics/overview"),
    refetchInterval: 30_000,
  });

  if (overviewQ.isError) {
    return (
      <div className="animate-fade-up space-y-5 pt-8">
        <h1 className="font-serif text-[21px] font-semibold tracking-tight text-paper-900">Analytics</h1>
        <ErrorState error={overviewQ.error} onRetry={() => void overviewQ.refetch()} />
      </div>
    );
  }

  const data = overviewQ.data;
  if (!data?.bySector || !data.byStage || !data.weeklyIngestion || !data.largestDeals || !data.byOwner) {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const stageTotal = Math.max(1, data.byStage.reduce((n, s) => n + s.count, 0));
  const pipelineUsd = Math.max(1, data.byStage.reduce((n, s) => n + s.usd, 0));

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader title="Analytics" subtitle="Pipeline composition, intake, and where capital sits" />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-paper-900/[0.09] bg-paper-900/[0.08] lg:grid-cols-4">
        <StatCard label="Active deals" value={String(data.activeDeals)} delta={data.activeDealsDeltaPct} />
        <StatCard label="Pipeline" value={money(data.totalPipelineUsd)} delta={data.totalPipelineDeltaPct} />
        <StatCard label="New founders · 30d" value={String(data.newFounders30d)} delta={data.newFoundersDeltaPct} />
        <StatCard label="Conversion rate" value={`${data.conversionRatePct}%`} delta={data.conversionDeltaPct} />
      </div>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-paper-900/[0.09] bg-paper-900/[0.08] lg:grid-cols-4">
        <StatCard label="Open" value={String(data.openDeals)} />
        <StatCard label="Won" value={String(data.wonDeals)} />
        <StatCard label="Passed" value={String(data.lostDeals)} />
        <StatCard label="Median ask" value={money(data.medianAskUsd)} hint={`avg ${money(data.avgAskUsd)}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section ref={funnelRef} className="panel overflow-hidden lg:col-span-3">
          <CaptionBar
            title="Pipeline value by stage"
            right={
              <button
                onClick={() => exportChartPng(funnelRef.current, "venturelabs-pipeline-by-stage.png")}
                className="text-[11px] font-medium text-brand-600 hover:underline"
              >
                ⬇ PNG
              </button>
            }
          />
          <div className="p-3 pr-4 text-paper-500">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.byStage} margin={{ top: 8, right: 0, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.18} />
                <XAxis dataKey="stageName" axisLine={{ stroke: "currentColor", strokeOpacity: 0.35 }} tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} interval={0} angle={-14} dy={6} />
                <YAxis tick={{ fontSize: 11, fill: "currentColor" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => money(v)} width={48} />
                <Tooltip
                  cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                  formatter={(value, _name, entry) => {
                    const p = entry?.payload as { count?: number };
                    return [`${money(value as number)} · ${p.count ?? 0} deals`, ""];
                  }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="usd" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {data.byStage.map((s) => (
                    <Cell key={s.stageId} fill={s.color} fillOpacity={0.9} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel overflow-hidden lg:col-span-2">
          <CaptionBar title="Stage mix" right={<span className="text-[10px] font-semibold uppercase tracking-wider text-paper-400">share of deals</span>} />
          <ul className="divide-y divide-paper-900/[0.05] px-1.5 py-1">
            {data.byStage.map((s, i) => {
              const prev = i === 0 ? null : data.byStage[i - 1]!.count;
              const step = prev && prev > 0 ? Math.round((s.count / prev) * 100) : null;
              return (
                <li key={s.stageId} className="px-2 py-2">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-paper-800">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />
                      <span className="truncate">{s.stageName}</span>
                    </span>
                    <span className="num shrink-0 text-paper-500">
                      {s.count}
                      <span className="text-paper-400"> · {Math.round((s.count / stageTotal) * 100)}%</span>
                      {step !== null && <span className="text-paper-400"> · {step}% of prior</span>}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper-900/[0.08]">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (s.usd / pipelineUsd) * 100)}%`, background: s.color }} />
                  </div>
                  <p className="mt-1 text-[11px] text-paper-400">{money(s.usd)} in stage</p>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <CaptionBar title="Weekly intake" right={<span className="text-xs text-paper-400">new deals</span>} />
          <div className="h-[260px] p-3 pr-4 text-paper-500">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.weeklyIngestion} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                <defs>
                  <linearGradient id="anFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f59bd" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#4f59bd" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.18} />
                <XAxis
                  dataKey="weekStart"
                  axisLine={{ stroke: "currentColor", strokeOpacity: 0.35 }}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  tickLine={false}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                />
                <YAxis tick={{ fontSize: 11, fill: "currentColor" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                  formatter={(value) => [`${value as number} deals`, ""]}
                />
                <Area type="monotone" dataKey="deals" stroke="#4f59bd" strokeWidth={1.5} fill="url(#anFill)" dot={false} activeDot={{ r: 3, fill: "#434aa3", stroke: "#fff", strokeWidth: 1.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <CaptionBar title="Weekly capital added" right={<span className="text-xs text-paper-400">ask on new deals</span>} />
          <div className="h-[260px] p-3 pr-4 text-paper-500">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.weeklyIngestion} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id="anUsd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f766e" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#0f766e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.18} />
                <XAxis
                  dataKey="weekStart"
                  axisLine={{ stroke: "currentColor", strokeOpacity: 0.35 }}
                  tick={{ fontSize: 10, fill: "currentColor" }}
                  tickLine={false}
                  tickFormatter={(v: string) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                />
                <YAxis tick={{ fontSize: 11, fill: "currentColor" }} axisLine={false} tickLine={false} tickFormatter={(v: number) => money(v)} width={44} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                  formatter={(value) => [money(value as number), ""]}
                />
                <Area type="monotone" dataKey="usd" stroke="#0f766e" strokeWidth={1.5} fill="url(#anUsd)" dot={false} activeDot={{ r: 3, fill: "#0f766e", stroke: "#fff", strokeWidth: 1.5 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <RankList title="Sectors" rows={data.bySector.map((r) => ({ key: r.name, label: r.name, count: r.count, usd: r.usd }))} />
        <RankList
          title="Source"
          rows={data.bySource.map((r) => ({
            key: r.source,
            label: SOURCE_LABEL[r.source] ?? r.source,
            count: r.count,
            usd: r.usd,
          }))}
        />
        <RankList title="Round" rows={data.byRound.map((r) => ({ key: r.round, label: r.round, count: r.count, usd: r.usd }))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel overflow-hidden lg:col-span-3">
          <CaptionBar title="Largest deals" right={<span className="text-[10px] font-semibold uppercase tracking-wider text-paper-400">by ask</span>} />
          <ul className="divide-y divide-paper-900/[0.05]">
            {data.largestDeals.map((deal) => (
              <li key={deal.id}>
                <Link to={`/app/companies/${deal.id}`} className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-paper-100">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: deal.stageColor }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-paper-900">{deal.name}</span>
                    <span className="block truncate text-[11px] text-paper-400">
                      {[deal.stageName, deal.roundStage, deal.sector].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[13px] font-semibold text-paper-800">{money(deal.askAmount)}</span>
                </Link>
              </li>
            ))}
            {data.largestDeals.length === 0 && <li className="px-3.5 py-6 text-sm text-paper-400">No deals yet.</li>}
          </ul>
        </section>

        <section className="panel overflow-hidden lg:col-span-2">
          <CaptionBar title="Owners" />
          <RankBody rows={data.byOwner.map((r) => ({ key: r.ownerId ?? "none", label: r.name, count: r.count, usd: r.usd }))} />
        </section>
      </div>
    </div>
  );
}

function RankList({ title, rows }: { title: string; rows: Array<{ key: string; label: string; count: number; usd: number }> }) {
  return (
    <section className="panel overflow-hidden">
      <CaptionBar title={title} />
      <RankBody rows={rows} />
    </section>
  );
}

function RankBody({ rows }: { rows: Array<{ key: string; label: string; count: number; usd: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.usd || r.count));
  if (rows.length === 0) return <p className="px-3.5 py-6 text-sm text-paper-400">Nothing to break down yet.</p>;
  return (
    <ul className="space-y-3 p-4">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium text-paper-800">{r.label}</span>
            <span className="num shrink-0 text-paper-500">
              {r.count} · <span className="font-semibold text-paper-800">{money(r.usd)}</span>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-paper-900/[0.08]">
            <div
              className="h-full rounded-full bg-brand-600"
              style={{ width: `${Math.max(2, ((r.usd || r.count) / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function exportChartPng(container: HTMLElement | null, filename: string) {
  const svg = container?.querySelector("svg");
  if (!svg) return;
  const xml = new XMLSerializer().serializeToString(svg);
  const img = new Image();
  const rect = svg.getBoundingClientRect();
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
  };
  img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(xml)))}`;
}

function StatCard({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number;
  hint?: string;
}) {
  return (
    <div className="bg-white p-5">
      <p className="text-xs font-medium text-paper-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num font-serif text-[32px] leading-none tracking-tight text-paper-900">{value}</span>
        {delta !== undefined && delta !== 0 && <DeltaChip value={delta} />}
      </div>
      {hint && <p className="mt-1.5 text-[11px] text-paper-400">{hint}</p>}
    </div>
  );
}
