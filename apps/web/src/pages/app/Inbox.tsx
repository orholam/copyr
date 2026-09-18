import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  Avatar, Badge, Button, EmptyState, ErrorState, PageHeader, Spinner, cx, timeAgo,
} from "../../components/ui";
import { IconInbox, IconMail, IconRefresh, IconSpark } from "../../components/icons";

interface Email {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  bodyText: string | null;
  attachments: Array<{ filename: string; mime: string; sizeBytes?: number }>;
  receivedAt: string;
  processingStatus: "queued" | "processing" | "processed" | "needs_review" | "failed";
  processedResult: {
    matchedCompanies?: string[];
    createdCompanies?: string[];
    createdDeals?: string[];
    confidence?: number;
    summary?: string;
  } | null;
  error: string | null;
}

const STATUS_TONE = {
  queued: "slate",
  processing: "amber",
  processed: "green",
  needs_review: "purple",
  failed: "red",
} as const;

const TABS = ["all", "queued", "processing", "processed", "failed"] as const;

export default function Inbox() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("all");

  const emailsQ = useQuery({
    queryKey: ["emails"],
    queryFn: () => api.get<{ items: Email[]; total?: number }>("/emails?limit=100"),
    refetchInterval: (q) =>
      q.state.data?.items.some((e) => e.processingStatus === "queued" || e.processingStatus === "processing")
        ? 2000
        : false,
  });

  const items = emailsQ.data?.items ?? [];
  const filtered = tab === "all" ? items : items.filter((e) => e.processingStatus === tab);
  const counts = Object.fromEntries(
    TABS.map((t) => [t, t === "all" ? items.length : items.filter((e) => e.processingStatus === t).length]),
  );
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];

  const simulate = useMutation({
    mutationFn: () =>
      api.post("/emails/simulate", {
        companyName: `DemoCo ${Math.floor(Math.random() * 900 + 100)}`,
        founderName: "Casey Demo",
        round: "Seed",
        askUsd: 3_000_000,
        arrUsd: 600_000,
        sectorHint: "dev tools",
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["emails"] }),
  });

  const bulkSimulate = useMutation({
    mutationFn: () =>
      api.post("/emails/simulate", {
        companyName: "BulkForward Demo",
        founderName: "Co-investor Forward",
        withDeck: false,
        bulkCompanies: [
          "Northwind Robotics", "Cobalt Health", "Vega Payments", "Orchid Bio",
          "Helios Energy", "Quanta Security", "Meridian Logistics", "Solstice AI",
        ],
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["emails"] }),
  });

  const reprocess = useMutation({
    mutationFn: (id: string) => api.post(`/emails/${id}/reprocess`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["emails"] }),
  });

  return (
    <div className="animate-fade-up -mx-6 -my-5 flex h-[calc(100vh-76px)] flex-col px-6 pb-4 pt-5">
      <PageHeader
        title="AI Inbox"
        subtitle="Forwarded pitch emails land here and become deals automatically"
        actions={
          <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => bulkSimulate.mutate()} disabled={bulkSimulate.isPending}>
            📬 Bulk forward
          </Button>
          <Button variant="outline" size="sm" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
            {simulate.isPending ? <Spinner className="h-3 w-3" /> : <IconMail width={12} height={12} />}
            Simulate inbound
          </Button>
          </div>
        }
      />

      {emailsQ.isError ? (
        <ErrorState error={emailsQ.error} onRetry={() => void emailsQ.refetch()} />
      ) : emailsQ.isLoading ? (
        <div className="flex justify-center py-24"><Spinner className="h-5 w-5" /></div>
      ) : !items.length ? (
        <EmptyState
          icon={<IconInbox width={16} height={16} />}
          title="Inbox zero"
          hint="Forward pitch emails to your Copyr address — or hit simulate to try the pipeline."
          action={<Button size="sm" onClick={() => simulate.mutate()}>Simulate inbound email</Button>}
        />
      ) : (
        <>
          <div className="mb-2.5 flex gap-0.5">
            {TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cx(
                  "flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium capitalize transition-colors",
                  tab === t
                    ? "bg-paper-900/[0.07] text-paper-900"
                    : "text-paper-500 hover:bg-paper-900/[0.04] hover:text-paper-800",
                )}
              >
                {t.replace("_", " ")}
                <span className="num text-[10px] font-semibold text-paper-400">{counts[t]}</span>
              </button>
            ))}
          </div>

          {/* mail client split view */}
          <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr] overflow-hidden rounded-xl border border-paper-900/[0.1] bg-white shadow-card">
            <div key={tab} className="animate-fade-in min-h-0 overflow-y-auto border-r border-paper-900/[0.08] bg-paper-100/60 p-1.5">
              {filtered.map((email) => {
                const active = selected?.id === email.id;
                return (
                  <button
                    key={email.id}
                    onClick={() => setSelectedId(email.id)}
                    className={cx(
                      "relative block w-full rounded-md px-2.5 py-2 text-left transition-colors duration-150",
                      active
                        ? "bg-white shadow-card ring-1 ring-paper-900/[0.08]"
                        : "hover:bg-paper-100",
                    )}
                  >
                    {active && <span className="absolute inset-y-1.5 -left-px w-[2px] rounded-full bg-brand-600" />}
                    <div className="flex items-center gap-2">
                      <Avatar name={email.fromName ?? email.fromEmail} size={22} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-4 text-paper-900">
                        {email.fromName ?? email.fromEmail}
                      </span>
                      <span className="shrink-0 text-[10px] font-medium text-paper-400">{timeAgo(email.receivedAt)}</span>
                      <span
                        className={cx(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          email.processingStatus === "processed"
                            ? "bg-emerald-500"
                            : email.processingStatus === "failed"
                              ? "bg-red-500"
                              : email.processingStatus === "needs_review"
                                ? "bg-violet-500"
                                : "animate-pulse bg-amber-500",
                        )}
                      />
                    </div>
                    <p className="mt-0.5 truncate pl-[30px] pr-4 text-xs leading-4 text-paper-500">{email.subject}</p>
                  </button>
                );
              })}
              {!filtered.length && <p className="py-10 text-center text-xs text-paper-400">Nothing in “{tab}”.</p>}
            </div>

            {selected ? (
              <div className="min-h-0 overflow-y-auto p-5">
                <h2 className="font-serif text-[22px] font-semibold leading-snug tracking-tight text-paper-900">{selected.subject}</h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-paper-500">
                  <b className="font-medium text-paper-700">{selected.fromName}</b>
                  <span>&lt;{selected.fromEmail}&gt;</span>
                  <span>·</span>
                  {timeAgo(selected.receivedAt)}
                  <Badge tone={STATUS_TONE[selected.processingStatus]}>{selected.processingStatus.replace("_", " ")}</Badge>
                </p>

                <pre className="mt-3.5 whitespace-pre-wrap rounded-md border border-paper-900/[0.09] bg-paper-50 p-3.5 font-sans text-[13px] leading-relaxed text-paper-800">
                  {selected.bodyText}
                </pre>

                <div
                  className={cx(
                    "mt-3.5 rounded-md border p-3.5",
                    selected.processingStatus === "failed"
                      ? "border-red-300 bg-red-50/70"
                      : "border-brand-300 bg-brand-50/80",
                  )}
                >
                  <div className="mb-2.5 flex items-center gap-1.5">
                    <IconSpark width={13} height={13} className="text-brand-600" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-brand-700">AI processing</span>
                    {(selected.processedResult?.confidence ?? 0) > 0 && (
                      <ConfidenceRing value={Math.round((selected.processedResult!.confidence ?? 0) * 100)} />
                    )}
                  </div>
                  {selected.processingStatus === "processed" && selected.processedResult ? (
                    <div className="space-y-2 text-[13px]">
                      {selected.processedResult.createdCompanies?.length ? (
                        <p className="text-paper-800">
                          Created companies{" "}
                          {selected.processedResult.createdCompanies.map((c) => (
                            <Badge key={c} tone="green" className="mr-1">{c}</Badge>
                          ))}
                        </p>
                      ) : null}
                      {selected.processedResult.matchedCompanies?.length ? (
                        <p className="text-paper-800">
                          Matched existing{" "}
                          {selected.processedResult.matchedCompanies.map((c) => (
                            <Badge key={c} tone="indigo" className="mr-1">{c}</Badge>
                          ))}
                        </p>
                      ) : null}
                      {!selected.processedResult.createdCompanies?.length &&
                        !selected.processedResult.matchedCompanies?.length && (
                          <p className="text-paper-700">{selected.processedResult.summary}</p>
                        )}
                      {!!selected.processedResult.createdDeals?.length && (
                        <p className="text-xs font-medium text-paper-500">
                          → {selected.processedResult.createdDeals.length} deal
                          {selected.processedResult.createdDeals.length > 1 ? "s" : ""} added to pipeline
                        </p>
                      )}
                    </div>
                  ) : selected.processingStatus === "failed" || selected.processingStatus === "needs_review" ? (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[13px] text-red-700">{selected.error ?? "Processing failed"}</p>
                      <Button size="sm" variant="outline" onClick={() => reprocess.mutate(selected.id)}>
                        <IconRefresh width={11} height={11} /> Reprocess
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[13px] text-paper-600">
                      <Spinner className="h-3 w-3" /> Working…
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <p className="text-[13px] text-paper-400">Select an email</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ConfidenceRing({ value }: { value: number }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative ml-auto inline-flex h-5 w-5 items-center justify-center text-paper-900/[0.12]">
      <svg width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
        <circle cx="10" cy="10" r={r} fill="none" stroke="currentColor" strokeWidth="2.5" />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="#10b981"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(value / 100) * c} ${c}`}
        />
      </svg>
      <span className="num absolute text-[7.5px] font-bold text-paper-900">{value}</span>
    </span>
  );
}
