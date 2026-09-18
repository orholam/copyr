import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Avatar, Badge, Button, Spinner, cx, inputCls, money, timeAgo } from "./ui";
import { IconDoc, IconX } from "./icons";

interface Deal {
  id: string;
  companyId: string;
  stageId: string;
  title: string;
  roundStage: string | null;
  askAmount: number | null;
  valuation: number | null;
  priority: number;
  nextStepAt: string | null;
  source: string;
  createdAt: string;
  company: { id: string; name: string; domain: string | null; sector: string | null; location: string | null; description?: string | null };
  fields: Record<string, string | number | boolean | string[] | null>;
}
interface Stage { id: string; name: string; color?: string; kind: "active" | "won" | "lost" }
interface Pipeline { id: string; stages: Stage[] }
interface CustomField { key: string; label: string; target: string; type: string }
interface Note { id: string; body: string; authorName?: string | null; createdAt: string }
interface Doc { id: string; name: string; parseStatus: string }
interface ActivityItem { id: string; summary: string; actor: string; type: string; createdAt: string }

const FALLBACK_COLOR: Record<string, string> = {
  active: "#5457e8",
  won: "#059669",
  lost: "#dc2626",
};

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-paper-600">
      {title}
      {count !== undefined && (
        <span className="num rounded-full bg-paper-100 px-1.5 text-[10px] font-semibold leading-4 text-paper-700 ring-1 ring-paper-900/[0.15]">
          {count}
        </span>
      )}
    </h3>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-paper-900/[0.12] bg-paper-50 px-3 py-2.5">
      <p className="text-[10.5px] font-bold uppercase tracking-wider text-paper-500">{label}</p>
      <p className={cx("num mt-1 text-[15px] font-semibold", accent ? "text-brand-700" : "text-paper-900")}>{value}</p>
    </div>
  );
}

export function DealDrawer() {
  const [params] = useSearchParams();
  const dealId = params.get("deal");
  const setParamsDyn = useSearchParams()[1];
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");
  const open = !!dealId;

  const close = () => {
    setParamsDyn(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("deal");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  const dealQ = useQuery({
    queryKey: ["deal", dealId],
    queryFn: () => api.get<Deal>(`/deals/${dealId}`),
    enabled: open,
  });
  const pipelinesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => api.get<Pipeline[]>("/pipelines") });
  const fieldsQ = useQuery({
    queryKey: ["custom-fields"],
    queryFn: () => api.get<CustomField[]>("/custom-fields"),
    enabled: open,
  });
  const notesQ = useQuery({
    queryKey: ["notes", "deal", dealId],
    queryFn: () => api.get<Note[]>(`/notes?dealId=${dealId}`),
    enabled: open,
  });
  const docsQ = useQuery({
    queryKey: ["documents", "deal", dealId],
    queryFn: () => api.get<{ items: Doc[] }>(`/documents?dealId=${dealId}`),
    enabled: open,
  });
  const activityQ = useQuery({
    queryKey: ["activity", "deal", dealId],
    queryFn: () => api.get<{ items: ActivityItem[] }>(`/activity?dealId=${dealId}&limit=25`),
    enabled: open,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["deal"] });
    void qc.invalidateQueries({ queryKey: ["deals"] });
    void qc.invalidateQueries({ queryKey: ["notes"] });
    void qc.invalidateQueries({ queryKey: ["documents"] });
    void qc.invalidateQueries({ queryKey: ["activity"] });
  };

  const moveStage = useMutation({
    mutationFn: (stageId: string) => api.patch(`/deals/${dealId}`, { stageId }),
    onSuccess: invalidate,
  });
  const addNote = useMutation({
    mutationFn: (body: string) => api.post("/notes", { dealId, body }),
    onSuccess: () => {
      setNoteBody("");
      invalidate();
    },
  });

  if (!open) return null;

  const deal = dealQ.data;
  const stages = pipelinesQ.data?.flatMap((p) => p.stages) ?? [];
  const currentStageId = deal?.stageId;
  const fieldLabels = new Map(
    (fieldsQ.data ?? []).filter((f) => f.target === "deal").map((f) => [f.key, f.label]),
  );
  const pretty = (k: string) =>
    fieldLabels.get(k) ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const entries = Object.entries(deal?.fields ?? {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "",
  );

  // Portal to body: the host page keeps a lingering transform (animate-fade-up),
  // which would otherwise become the containing block for this fixed overlay.
  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-paper-900/25 backdrop-blur-[2px] dark:bg-black/60"
      onMouseDown={close}
    >
      <aside
        className="animate-slide-in-right flex h-full w-[480px] max-w-[94vw] flex-col overflow-hidden border-l border-paper-900/[0.14] bg-white shadow-pop"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {!deal ? (
          <div className="flex justify-center pt-24"><Spinner className="h-6 w-6" /></div>
        ) : (
          <>
            <header className="shrink-0 border-b border-paper-900/[0.1] bg-white px-5 pb-3.5 pt-4">
              <div className="flex items-start gap-3">
                <Avatar name={deal.company.name} size={42} />
                <div className="min-w-0 flex-1 pt-0.5">
                  <Link
                    to={`/app/companies/${deal.company.id}`}
                    onClick={close}
                    className="block truncate font-serif text-lg font-semibold leading-6 tracking-tight text-paper-900 hover:text-brand-800"
                  >
                    {deal.company.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[13px] font-medium text-paper-600">
                    {[deal.company.sector, deal.company.location].filter(Boolean).join(" · ") || deal.title}
                  </p>
                </div>
                <button
                  onClick={close}
                  aria-label="Close"
                  className="-mr-1.5 -mt-1 rounded-lg p-2 text-paper-500 transition hover:bg-paper-100 hover:text-paper-900"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>

              <div className="no-scrollbar mt-3.5 flex items-center gap-1 overflow-x-auto rounded-lg bg-paper-100 p-1">
                {stages.map((s) => {
                  const active = s.id === currentStageId;
                  const dotColor = s.color ?? FALLBACK_COLOR[s.kind];
                  return (
                    <button
                      key={s.id}
                      disabled={moveStage.isPending}
                      onClick={() => moveStage.mutate(s.id)}
                      className={cx(
                        "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all",
                        active
                          ? "bg-white text-paper-900 shadow-card"
                          : "text-paper-500 hover:bg-white/60 hover:text-paper-800",
                      )}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: dotColor }}
                      />
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </header>

            <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
              <section>
                <div className="grid grid-cols-3 gap-2.5">
                  <Stat label="Round" value={deal.roundStage ?? "—"} />
                  <Stat label="Ask" value={money(deal.askAmount)} accent />
                  <Stat label="Valuation" value={money(deal.valuation)} />
                </div>
                {(deal.priority >= 4 || deal.nextStepAt) && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    {deal.priority >= 4 && (
                      <Stat label="Priority" value={deal.priority >= 5 ? "High 🔥" : "Elevated"} accent={deal.priority >= 5} />
                    )}
                    {deal.nextStepAt && (
                      <Stat label="Next step" value={new Date(deal.nextStepAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} />
                    )}
                  </div>
                )}
              </section>

              <section>
                <SectionHeader title="AI-extracted fields" count={entries.length || undefined} />
                {entries.length ? (
                  <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 rounded-xl border border-paper-900/[0.1] bg-white p-4">
                    {entries.map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-paper-500">{pretty(k)}</dt>
                        <dd className="mt-0.5 text-[13.5px] font-medium text-paper-900">
                          {Array.isArray(v) ? v.join(", ") : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="rounded-xl border border-dashed border-paper-900/[0.18] px-4 py-3 text-[13px] text-paper-600">
                    No fields extracted yet — upload a deck to fill these.
                  </p>
                )}
              </section>

              <section>
                <SectionHeader title="Documents" count={docsQ.data?.items?.length || undefined} />
                {docsQ.data?.items?.length ? (
                  <ul className="space-y-2">
                    {(docsQ.data?.items ?? []).map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center gap-2.5 rounded-lg border border-paper-900/[0.12] bg-white px-3 py-2.5 transition-colors hover:border-paper-900/25"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 ring-1 ring-inset ring-brand-200">
                          <IconDoc width={15} height={15} className="text-brand-700" />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-paper-900">{doc.name}</span>
                        {doc.parseStatus === "parsed" ? (
                          <a
                            href="#"
                            onClick={async (e) => {
                              e.preventDefault();
                              const { url } = await api.get<{ url: string }>(`/documents/${doc.id}/download-url`);
                              window.open(url, "_blank");
                            }}
                            className="shrink-0 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          <Badge tone={doc.parseStatus === "failed" ? "red" : "amber"}>{doc.parseStatus}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-paper-900/[0.18] px-4 py-3 text-[13px] text-paper-600">No decks attached.</p>
                )}
              </section>

              <section>
                <SectionHeader title="Notes" count={notesQ.data?.length || undefined} />
                <div className="flex gap-2">
                  <input
                    value={noteBody}
                    onChange={(e) => setNoteBody(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && noteBody.trim() && addNote.mutate(noteBody)}
                    placeholder="Add an internal note…"
                    className={cx(inputCls, "h-9 py-0")}
                  />
                  <Button
                    size="sm"
                    disabled={!noteBody.trim() || addNote.isPending}
                    onClick={() => addNote.mutate(noteBody)}
                  >
                    Add
                  </Button>
                </div>
                <ul className="mt-3 space-y-2">
                  {(notesQ.data ?? []).map((n) => (
                    <li key={n.id} className="rounded-lg border border-paper-900/[0.1] bg-paper-50 px-3.5 py-2.5">
                      <p className="text-[13.5px] leading-relaxed text-paper-900">{n.body}</p>
                      <p className="num mt-1.5 text-[11px] font-medium text-paper-500">
                        {n.authorName ?? "system"} · {timeAgo(n.createdAt)}
                      </p>
                    </li>
                  ))}
                  {!notesQ.data?.length && <li className="text-[13px] text-paper-500">No notes yet.</li>}
                </ul>
              </section>

              <section>
                <SectionHeader title="Timeline" />
                <ul className="relative space-y-4 border-l border-paper-900/[0.12] pl-5">
                  {(activityQ.data?.items ?? []).map((a) => (
                    <li key={a.id} className="relative">
                      <span
                        className={cx(
                          "absolute -left-[26px] top-0.5 h-3 w-3 rounded-full border-[2.5px] border-white shadow-[0_0_0_1px_rgba(23,22,19,0.12)]",
                          a.actor === "ai" ? "bg-violet-400" : a.actor === "user" ? "bg-brand-500" : "bg-paper-400",
                        )}
                      />
                      <p className="text-[13px] font-medium leading-snug text-paper-800">{a.summary}</p>
                      <p className="num mt-0.5 text-[11px] font-medium capitalize text-paper-500">
                        {a.actor} · {timeAgo(a.createdAt)}
                      </p>
                    </li>
                  ))}
                  {!activityQ.data?.items?.length && <li className="text-[13px] text-paper-500">No activity yet.</li>}
                </ul>
              </section>
            </div>
          </>
        )}
      </aside>
    </div>,
    document.body,
  );
}
