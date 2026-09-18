import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { api } from "../../lib/api";
import { Avatar, DeltaChip, ErrorState, PageHeader, Skeleton, money, timeAgo, cx } from "../../components/ui";
import { IconBot, IconSettings as IconGear, IconUser } from "../../components/icons";

interface Overview {
  activeDeals: number;
  activeDealsDeltaPct: number;
  totalPipelineUsd: number;
  totalPipelineDeltaPct: number;
  newFounders30d: number;
  newFoundersDeltaPct: number;
  conversionRatePct: number;
  conversionDeltaPct: number;
  byStage: Array<{ stageId: string; stageName: string; color: string; count: number; usd: number }>;
  weeklyIngestion: Array<{ weekStart: string; deals: number }>;
}

interface ActivityItem {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  actor: "user" | "ai" | "system";
  summary: string;
  createdAt: string;
}

interface DealLite {
  id: string;
  companyId: string;
  stageId: string;
  askAmount: number | null;
  updatedAt: string;
  company: { id: string; name: string };
}

const TICK = { fontSize: 10, fill: "currentColor" };

function CaptionBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-paper-900/[0.07] bg-paper-100/70 px-3.5 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-paper-600">{title}</p>
      {right}
    </div>
  );
}

export default function Dashboard() {
  const overviewQ = useQuery({
    queryKey: ["analytics"],
    queryFn: () => api.get<Overview>("/analytics/overview"),
    refetchInterval: 30_000,
  });
  const activityQ = useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<{ items: ActivityItem[] }>("/activity?limit=9"),
  });
  const dealsQ = useQuery({
    queryKey: ["deals", "recent"],
    queryFn: () => api.get<{ items: DealLite[] }>("/deals?limit=6&sort=updated_at&order=desc"),
  });

  const d = overviewQ.data;
  const maxCount = Math.max(1, ...(d?.byStage.map((s) => s.count) ?? [1]));

  if (overviewQ.isError || activityQ.isError || dealsQ.isError) {
    const err = overviewQ.error ?? activityQ.error ?? dealsQ.error;
    return (
      <div className="animate-fade-up space-y-5 pt-8">
        <h1 className="font-serif text-[21px] font-semibold tracking-tight text-paper-900">Dashboard</h1>
        <ErrorState error={err} onRetry={() => { void overviewQ.refetch(); void activityQ.refetch(); void dealsQ.refetch(); }} />
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-4">
      <PageHeader
        title="Dashboard"
        actions={
          <Link
            to="/app/analytics"
            className="inline-flex h-7 items-center rounded-md border border-paper-900/[0.15] bg-white px-2.5 text-[12.5px] font-medium text-paper-800 transition hover:border-paper-900/30 hover:bg-paper-50"
          >
            Full analytics →
          </Link>
        }
      />

      {/* stat strip */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-paper-900/[0.09] bg-paper-900/[0.08] lg:grid-cols-4">
        {d ? (
          <>
            <Stat label="Active deals" value={String(d.activeDeals)} delta={d.activeDealsDeltaPct} />
            <Stat label="Pipeline value" value={money(d.totalPipelineUsd)} delta={d.totalPipelineDeltaPct} />
            <Stat label="New founders · 30d" value={String(d.newFounders30d)} delta={d.newFoundersDeltaPct} />
            <Stat label="Conversion rate" value={`${d.conversionRatePct}%`} delta={d.conversionDeltaPct} plainDelta />
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-6 w-16" />
            </div>
          ))
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* funnel */}
        <section className="panel overflow-hidden lg:col-span-2">
          <CaptionBar title="Pipeline by stage" />
          <div className="space-y-3.5 p-4">
            {(d?.byStage ?? []).map((s) => (
              <div key={s.stageId}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="font-medium text-paper-800">{s.stageName}</span>
                  <span className="num text-paper-500">
                    {s.count} · <span className="font-semibold text-paper-800">{money(s.usd)}</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-paper-900/[0.08]">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.max(2, (s.count / maxCount) * 100)}%`, background: s.color }}
                  />
                </div>
              </div>
            ))}
            {!d && Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-1.5 w-full" />)}
          </div>
        </section>

        {/* ingestion chart */}
        <section className="panel overflow-hidden lg:col-span-3">
          <CaptionBar title="Weekly intake" />
          <div className="h-[300px] p-3 pr-4 text-paper-500">
            {d && (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={d.weeklyIngestion} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
                  <defs>
                    <linearGradient id="ingestFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4f59bd" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="#4f59bd" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="weekStart"
                    tick={TICK}
                    axisLine={{ stroke: "currentColor", strokeOpacity: 0.35 }}
                    tickLine={false}
                    tickFormatter={(v: string) =>
                      new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })
                    }
                    interval="preserveStartEnd"
                  />
                  <Tooltip
                    cursor={{ stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "3 3" }}
                    contentStyle={{
                      background: "rgb(var(--surface))",
                      border: "1px solid rgb(var(--paper-900) / 0.12)",
                      borderRadius: 8,
                      fontSize: 12,
                      color: "rgb(var(--paper-800))",
                      boxShadow: "0 8px 24px -8px rgba(0,0,0,.3)",
                    }}
                    labelFormatter={(v) => new Date(String(v)).toLocaleDateString()}
                    formatter={(value) => [`${value as number} deals`, ""]}
                  />
                  <Area
                    type="monotone"
                    dataKey="deals"
                    stroke="#4f59bd"
                    strokeWidth={1.75}
                    fill="url(#ingestFill)"
                    dot={false}
                    activeDot={{ r: 3, fill: "#434aa3", strokeWidth: 1.5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* recent activity */}
        <section className="panel overflow-hidden">
          <CaptionBar
            title="Latest activity"
            right={<span className="text-[10px] font-semibold uppercase tracking-wider text-paper-400">user · AI · system</span>}
          />
          <ul className="divide-y divide-paper-900/[0.05] px-1.5 py-1">
            {(activityQ.data?.items ?? []).map((a) => (
              <li key={a.id} className="flex items-center gap-3 rounded-md px-2 py-2">
                <span
                  className={cx(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-paper-900/[0.08]",
                    a.actor === "ai"
                      ? "bg-violet-50 text-violet-600"
                      : a.actor === "user"
                        ? "bg-brand-50 text-brand-700"
                        : "bg-paper-100 text-paper-500",
                  )}
                >
                  {a.actor === "ai" ? <IconBot width={12} height={12} /> : a.actor === "user" ? <IconUser width={12} height={12} /> : <IconGear width={12} height={12} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-paper-800">{a.summary}</span>
                <span className="shrink-0 text-[11px] text-paper-400">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
            {!activityQ.data && Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mx-2 my-2 h-4 w-full" />)}
          </ul>
        </section>

        {/* recently touched deals */}
        <section className="panel overflow-hidden">
          <CaptionBar title="Recently updated" />
          <ul className="divide-y divide-paper-900/[0.05] px-1.5 py-1">
            {(dealsQ.data?.items ?? []).map((deal) => (
              <li key={deal.id}>
                <Link
                  to={`/app/pipeline?deal=${deal.id}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-paper-100"
                >
                  <Avatar name={deal.company.name} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-paper-900">{deal.company.name}</span>
                  <span className="text-[11px] text-paper-400">{timeAgo(deal.updatedAt)}</span>
                  {deal.askAmount !== null && (
                    <span className="num w-14 shrink-0 text-right text-[13px] font-semibold text-paper-800">{money(deal.askAmount)}</span>
                  )}
                </Link>
              </li>
            ))}
            {!dealsQ.data &&
              Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="mx-2 my-2 h-6 w-full" />)}
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  plainDelta,
}: {
  label: string;
  value: string;
  delta?: number;
  plainDelta?: boolean;
}) {
  return (
    <div className="bg-white p-5">
      <p className="text-xs font-medium text-paper-500">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="num font-serif text-[32px] leading-none tracking-tight text-paper-900">{value}</span>
        {delta !== undefined && !plainDelta && <DeltaChip value={delta} />}
        {delta !== undefined && plainDelta && delta > 0 && <DeltaChip value={delta} />}
      </div>
    </div>
  );
}
