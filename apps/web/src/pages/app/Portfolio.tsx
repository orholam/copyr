import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { Avatar, Badge, EmptyState, PageHeader, Skeleton, timeAgo } from "../../components/ui";
import { IconFolder } from "../../components/icons";

interface Update {
  id: string;
  companyId: string;
  companyName?: string;
  title: string;
  body: string | null;
  kind: "milestone" | "metric" | "hiring" | "funding" | "news" | "update";
  occurredAt: string;
}

const KIND_TONE = {
  milestone: "green",
  metric: "indigo",
  hiring: "purple",
  funding: "amber",
  news: "slate",
  update: "slate",
} as const;

export default function Portfolio() {
  const updatesQ = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => api.get<{ items: Update[] }>("/portfolio-updates?limit=100"),
  });

  return (
    <div className="animate-fade-up mx-auto max-w-4xl">
      <PageHeader
        title="Portfolio"
        subtitle="Updates extracted automatically from inbound portco emails"
      />

      {updatesQ.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : !updatesQ.data?.items.length ? (
        <EmptyState
          icon={<IconFolder width={20} height={20} />}
          title="No portfolio updates yet"
          hint="When a company with a won deal sends an update email, it appears here automatically."
        />
      ) : (
        <div className="relative border-l border-paper-900/[0.09] pl-5">
          {updatesQ.data.items.map((u) => (
            <div key={u.id} className="relative mb-3">
              <span className="absolute -left-[26px] top-4 h-2 w-2 rounded-full border-2 border-white bg-brand-400" />
              <div className="panel p-3.5 transition-colors hover:border-paper-900/[0.16]">
                <div className="flex flex-wrap items-center gap-2">
                  <Avatar name={u.companyName ?? u.companyId.slice(0, 8)} size={26} />
                  <Link to={`/app/companies/${u.companyId}`} className="text-[13px] font-medium text-brand-700 hover:underline">
                    {u.companyName ?? u.companyId.slice(0, 8)}
                  </Link>
                  <Badge tone={KIND_TONE[u.kind]}>{u.kind}</Badge>
                  <span className="ml-auto shrink-0 text-[11px] text-paper-500">{timeAgo(u.occurredAt)}</span>
                </div>
                <p className="mt-1.5 text-[13px] font-medium text-paper-800">{u.title}</p>
                {u.body && <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-paper-500">{u.body}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
