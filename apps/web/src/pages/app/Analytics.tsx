import { useRef } from "react";
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
import { DeltaChip, PageHeader, Skeleton } from "../../components/ui";

interface Overview {
  activeDeals: number;
  activeDealsDeltaPct: number;
  totalPipelineUsd: number;
  totalPipelineDeltaPct: number;
  newFounders30d: number;
  newFoundersDeltaPct: number;
  conversionRatePct: number;
  byStage: Array<{ stageId: string; stageName: string; color: string; count: number; usd: number }>;
  weeklyIngestion: Array<{ weekStart: string; deals: number }>;
}

const TOOLTIP_STYLE = {
  background: "rgb(var(--surface))",
  border: "1px solid rgb(var(--paper-900) / 0.12)",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--paper-800))",
  boxShadow: "0 8px 24px -8px rgba(0,0,0,.3)",
};

const _TICK = { fontSize: 10, fill: "currentColor" };

export default function Analytics() {
  const funnelRef = useRef<HTMLDivElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api.get<Overview>("/analytics/overview"),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    );
  }

  const fmt = (n: number) =>
    n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${Math.round(n / 1e6)}M` : `$${Math.round(n / 1e3)}K`;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Analytics" subtitle="Realtime deal-flow insights" />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-paper-900/[0.09] bg-paper-200/70 lg:grid-cols-4">
        <StatCard label="Active deals" value={String(data.activeDeals)} delta={data.activeDealsDeltaPct} />
        <StatCard label="Pipeline" value={fmt(data.totalPipelineUsd)} delta={data.totalPipelineDeltaPct} />
        <StatCard label="New founders · 30d" value={String(data.newFounders30d)} delta={data.newFoundersDeltaPct} />
        <StatCard label="Conversion rate" value={`${data.conversionRatePct}%`} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section ref={funnelRef} className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-paper-900/[0.07] bg-paper-100/70 px-3.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-paper-600">Pipeline by stage</p>
            <button onClick={() => exportChartPng(funnelRef.current, "venturelabs-pipeline-by-stage.png")} className="text-[11px] font-medium text-brand-600 hover:underline">⬇ PNG</button>
            <p className="text-xs text-paper-400">deal count per stage, in your stage colors</p>
          </div>
          <div className="p-3 pr-4 text-paper-500">
          <ResponsiveContainer width="100%" height={330}>
            <BarChart data={data.byStage} margin={{ top: 8, right: 0, bottom: 0, left: -24 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.18} />
              <XAxis dataKey="stageName" axisLine={{ stroke: "currentColor", strokeOpacity: 0.35 }} tick={{ fontSize: 10, fill: "currentColor" }} tickLine={false} interval={0} angle={-14} dy={6} />
              <YAxis tick={{ fontSize: 11, fill: "currentColor" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: "currentColor", fillOpacity: 0.06 }}
                formatter={(value, _name, entry) => {
                  const p = entry?.payload as { usd?: number };
                  return [`${value as number} deals (${fmt(p.usd ?? 0)})`, ""];
                }}
                contentStyle={TOOLTIP_STYLE}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {data.byStage.map((s) => (
                  <Cell key={s.stageId} fill={s.color} fillOpacity={0.9} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-paper-900/[0.07] bg-paper-100/70 px-3.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wider text-paper-600">Weekly intake</p>
            <p className="text-xs text-paper-400">new deals created per week</p>
          </div>
          <div className="p-3 pr-4 text-paper-500">
          <ResponsiveContainer width="100%" height={330}>
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
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                }
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
      </div>
    </div>
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
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="bg-white p-5">
      <p className="text-xs font-medium text-paper-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num font-serif text-[32px] leading-none tracking-tight text-paper-900">{value}</span>
        {delta !== undefined && delta !== 0 && <DeltaChip value={delta} />}
      </div>
    </div>
  );
}
