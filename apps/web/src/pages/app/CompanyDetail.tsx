import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { usePresence } from "../../lib/presence";
import {
  Avatar, Badge, Button, Field, Modal, PageHeader, Panel, Select, Skeleton, Spinner, cx, inputCls, money, timeAgo,
} from "../../components/ui";
import {
  IconArrowUpRight, IconBot, IconDoc, IconMapPin, IconSpark, IconUser,
} from "../../components/icons";
import { isScreenTag, parseScreenTag, stripScreenTags, type ScreenRec } from "../../lib/screenTag";

function ScreenBadge({
  recommendation,
  fitScore,
}: {
  recommendation: ScreenRec;
  fitScore?: number | null;
}) {
  const tone = recommendation === "advance" ? "green" : recommendation === "pass" ? "red" : "amber";
  return (
    <Badge tone={tone}>
      {recommendation.toUpperCase()}
      {fitScore != null ? ` · ${fitScore}` : ""}
    </Badge>
  );
}

interface Participant {
  id: string;
  name: string;
  firm: string | null;
  email: string | null;
  occurredAt: string | null;
}
interface Company {
  id: string;
  name: string;
  domain: string | null;
  sector: string | null;
  location: string | null;
  description: string | null;
  foundedYear: number | null;
  employeeCount: number | null;
  tags?: string[];
  status: string;
  source: string;
  stageId: string;
  roundStage: string | null;
  roundLabel: string | null;
  askAmount: number | null;
  valuation: number | null;
  firmInvested: boolean | null;
  syndicateStatus: "queued" | "presented" | null;
  submittedAt: string | null;
  submittedBy: Participant | null;
  upvoters: Participant[];
  priority: number;
  nextStepAt: string | null;
  fields: Record<string, string | number | boolean | string[] | null>;
}
interface Stage { id: string; name: string; kind: string }
interface Document_ {
  id: string; name: string; parseStatus: string; pageCount: number | null; createdAt: string; sourceUrl: string | null;
}
interface Note { id: string; body: string; authorName?: string | null; createdAt: string; pinned: boolean }
interface Activity {
  id: string;
  type: string;
  summary: string;
  actor: string;
  createdAt: string;
  data?: Record<string, unknown> | null;
}
interface Contact { id: string; name: string; email: string | null; title: string | null; isFounder: boolean }
interface SpaceSummary { id: string; name: string; companyId: string | null }
interface TaskItem { id: string; title: string; status: string; spaceId: string | null }

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [noteBody, setNoteBody] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  usePresence("company", id ?? "");

  const linksQ = useQuery({
    queryKey: ["share-links", id],
    queryFn: () => api.get<ShareLink[]>("/share-links"),
    enabled: !!id,
  });
  const companyLinks = (linksQ.data ?? []).filter((l) => l.companyId === id);

  const createLink = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<ShareLink>("/share-links", { ...payload, companyId: id }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["share-links", id] }),
  });
  const revokeLink = useMutation({
    mutationFn: (linkId: string) => api.delete(`/share-links/${linkId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["share-links", id] }),
  });

  const relQ = useQuery({
    queryKey: ["relationships", id],
    queryFn: () =>
      api.get<Array<{ contactEmail: string; teamMemberName: string | null; interactionCount: number; lastInteractionAt: string }>>(
        `/companies/${id}/relationships`,
      ),
    enabled: !!id,
  });

  const [thesis, setThesis] = useState<{ memo: string } | null>(null);
  const genThesis = useMutation({
    mutationFn: () => api.post<{ memo: string }>(`/companies/${id}/thesis`),
    onSuccess: setThesis,
  });

  const [newTag, setNewTag] = useState("");
  const saveTags = useMutation({
    mutationFn: (tags: string[]) => api.patch(`/companies/${id}`, { tags }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["company", id] }),
  });

  const [mergeInto, setMergeInto] = useState("");
  const doMerge = useMutation({
    mutationFn: () => api.post(`/companies/${id}/merge`, { intoCompanyId: mergeInto }),
    onSuccess: () => {
      window.location.href = `/app/companies/${mergeInto}`;
    },
  });

  const companyQ = useQuery({
    queryKey: ["company", id],
    queryFn: () => api.get<Company>(`/companies/${id}`),
    enabled: !!id,
  });
  const stagesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => api.get<Array<{ id: string; name: string; stages: Stage[] }>>("/pipelines") });
  const docsQ = useQuery({
    queryKey: ["documents", id],
    queryFn: () => api.get<{ items: Document_[] }>(`/documents?companyId=${id}`),
    enabled: !!id,
  });
  const notesQ = useQuery({
    queryKey: ["notes", id],
    queryFn: () => api.get<Note[]>(`/notes?companyId=${id}`),
    enabled: !!id,
  });
  const activityQ = useQuery({
    queryKey: ["activity", id],
    queryFn: () => api.get<{ items: Activity[] }>(`/activity?companyId=${id}&limit=30`),
    enabled: !!id,
  });
  const allCompaniesQ = useQuery({
    queryKey: ["companies-all"],
    queryFn: () => api.get<{ items: Array<{ id: string; name: string }> }>("/companies?limit=200"),
    enabled: !!id,
  });
  const contactsQ = useQuery({
    queryKey: ["contacts", id],
    queryFn: () => api.get<Contact[]>(`/companies/${id}/contacts`),
    enabled: !!id,
  });

  const saveSyndicate = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api.patch(`/deals/${id}`, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["company", id] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
    },
  });

  const moveStage = useMutation({
    mutationFn: (stageId: string) => api.patch(`/deals/${id}`, { stageId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["company", id] });
      void qc.invalidateQueries({ queryKey: ["deals"] });
      void qc.invalidateQueries({ queryKey: ["activity", id] });
    },
  });

  const addNote = useMutation({
    mutationFn: () => api.post("/notes", { companyId: id, body: noteBody }),
    onSuccess: () => {
      setNoteBody("");
      void qc.invalidateQueries({ queryKey: ["notes", id] });
      void qc.invalidateQueries({ queryKey: ["activity", id] });
    },
  });

  if (companyQ.isError) {
    return (
      <div className="animate-fade-up rounded-xl border border-red-500/20 bg-red-500/[0.06] p-6 text-sm text-red-700">
        Couldn’t load this company. {(companyQ.error as Error)?.message ?? "Try refreshing."}
      </div>
    );
  }
  if (!companyQ.data || Array.isArray(companyQ.data)) {
    return (
      <div className="animate-fade-up space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-[1fr_320px] gap-6">
          <div className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
          <Skeleton className="h-60 w-full" />
        </div>
      </div>
    );
  }
  const c = companyQ.data;
  const allStages = stagesQ.data?.flatMap((p) => p.stages) ?? [];
  const stage = allStages.find((s) => s.id === c.stageId);
  const fieldEntries = Object.entries(c.fields ?? {}).filter(([, v]) => v !== null && v !== undefined);
  const screen = parseScreenTag(c.tags);
  const userTags = stripScreenTags(c.tags ?? []);

  return (
    <div className="animate-fade-up mx-auto max-w-5xl pb-10">
      <PageHeader
        title=""
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => genThesis.mutate()}
              disabled={genThesis.isPending}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-paper-900/[0.14] bg-paper-100 px-3 text-xs font-medium text-paper-800 transition hover:bg-paper-200/70"
            >
              {genThesis.isPending ? "Drafting…" : "✨ Thesis"}
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-brand-600 px-3 text-xs font-semibold text-white transition hover:bg-brand-700"
            >
              🔗 Share{companyLinks.length > 0 && ` (${companyLinks.length})`}
            </button>
            <Link
              to="/app/pipeline"
              className="flex h-8 items-center gap-1 rounded-lg border border-paper-900/[0.14] bg-paper-100 px-3 text-xs font-medium text-paper-800 transition hover:bg-paper-200/70"
            >
              ← Pipeline
            </Link>
          </div>
        }
      />

      <header className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <Avatar name={c.name} size={44} />
            <div>
              <h1 className="text-[17px] font-semibold leading-6 tracking-[-0.01em] text-paper-900">{c.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-paper-500">
                {c.domain && (
                  <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-brand-700 hover:underline">
                    {c.domain} <IconArrowUpRight width={11} height={11} />
                  </a>
                )}
                {c.sector && <Badge tone="indigo">{c.sector}</Badge>}
                {c.location && (
                  <span className="flex items-center gap-1"><IconMapPin width={12} height={12} className="text-paper-500" />{c.location}</span>
                )}
                {c.foundedYear && <span>Founded {c.foundedYear}</span>}
                {c.employeeCount != null && <span>{c.employeeCount.toLocaleString()} people</span>}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {screen && (
              <ScreenBadge recommendation={screen.recommendation} fitScore={screen.fitScore} />
            )}
            {c.syndicateStatus && (
              <Badge tone={c.syndicateStatus === "presented" ? "green" : "amber"}>{c.syndicateStatus}</Badge>
            )}
            {c.firmInvested && <Badge tone="indigo">Firm invested</Badge>}
            {stage && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-paper-900/[0.11] bg-paper-100 px-2 py-1 text-xs font-medium text-paper-800">
                <span className={cx("h-1.5 w-1.5 rounded-full", stage.kind === "won" ? "bg-emerald-400/80" : stage.kind === "lost" ? "bg-red-400/80" : "bg-brand-400")} />
                {stage.name}
              </span>
            )}
            <Badge tone={c.status === "portfolio" ? "green" : c.status === "active" ? "slate" : "purple"}>{c.status}</Badge>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-paper-900/[0.09] pt-3.5">
          <Meta label="Round" value={c.roundLabel || c.roundStage || "—"} />
          <Meta label="Ask" value={money(c.askAmount)} accent />
          <Meta label="Valuation" value={money(c.valuation)} />
          {c.submittedAt && (
            <Meta
              label="Submitted"
              value={new Date(c.submittedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            />
          )}
          {(c.upvoters?.length ?? 0) > 0 && <Meta label="Votes" value={String(c.upvoters.length)} accent />}
          {c.priority >= 4 && <Meta label="Priority" value={c.priority >= 5 ? "High" : "Elevated"} accent={c.priority >= 5} />}
          {c.nextStepAt && (
            <Meta
              label="Next step"
              value={new Date(c.nextStepAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            />
          )}
        </div>
        {allStages.length > 0 && (
          <div className="no-scrollbar mt-3.5 flex items-center gap-1 overflow-x-auto rounded-lg bg-paper-100 p-1">
            {allStages.map((s) => {
              const active = s.id === c.stageId;
              return (
                <button
                  key={s.id}
                  type="button"
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
                    className={cx(
                      "h-1.5 w-1.5 rounded-full",
                      s.kind === "won" ? "bg-emerald-500" : s.kind === "lost" ? "bg-red-500" : "bg-brand-500",
                    )}
                  />
                  {s.name}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {c.description && (
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-paper-600">{c.description}</p>
      )}

      <SyndicatePanel
        company={c}
        saving={saveSyndicate.isPending}
        error={saveSyndicate.error instanceof Error ? saveSyndicate.error.message : null}
        onPatch={(patch) => saveSyndicate.mutate(patch)}
      />

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          {fieldEntries.length > 0 && (
            <Panel title="AI-extracted attributes" icon={<IconSpark width={13} height={13} />}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
                {fieldEntries.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] capitalize text-paper-500">{k.replace(/_/g, " ")}</dt>
                    <dd className="mt-0.5 text-sm font-medium text-paper-900">
                      {Array.isArray(v) ? v.join(", ") : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}

          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {userTags.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-paper-200/70 px-2 py-0.5 text-[11px] font-medium text-paper-700">
                #{t}
                <button
                  className="text-paper-400 transition hover:text-red-500"
                  onClick={() =>
                    saveTags.mutate([
                      ...stripScreenTags(c.tags ?? []).filter((x) => x !== t),
                      ...(c.tags ?? []).filter(isScreenTag),
                    ])
                  }
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTag.trim()) {
                  saveTags.mutate([
                    ...stripScreenTags(c.tags ?? []),
                    newTag.trim().toLowerCase(),
                    ...(c.tags ?? []).filter(isScreenTag),
                  ]);
                  setNewTag("");
                }
              }}
              placeholder="+ tag"
              className="w-24 rounded-full border border-dashed border-paper-900/[0.18] px-2.5 py-0.5 text-[11px] outline-none focus:border-brand-400"
            />
          </div>
          {saveTags.isError && (
            <p className="mb-2 text-xs text-red-500">{(saveTags.error as Error).message}</p>
          )}

          <Panel title="Documents" icon={<IconDoc width={13} height={13} />}>
            {!docsQ.data?.items?.length ? (
              <p className="text-sm text-paper-500">No decks attached.</p>
            ) : (
              <ul className="space-y-2">
                {(docsQ.data?.items ?? []).map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between rounded-lg border border-paper-900/[0.08] bg-paper-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-paper-900">{doc.name}</p>
                      <p className="text-[11px] text-paper-500">
                        {doc.pageCount ? `${doc.pageCount} pages · ` : ""}
                        {timeAgo(doc.createdAt)}
                        {doc.sourceUrl && <> · from link</>}
                      </p>
                    </div>
                    {doc.parseStatus === "parsed" ? (
                      <a
                        href="#"
                        onClick={async (e) => {
                          e.preventDefault();
                          const { url } = await api.get<{ url: string }>(`/documents/${doc.id}/download-url`);
                          window.open(url, "_blank");
                        }}
                        className="shrink-0 text-xs font-medium text-brand-700 hover:underline"
                      >
                        View
                      </a>
                    ) : (
                      <Badge tone={doc.parseStatus === "failed" ? "red" : "amber"}>{doc.parseStatus}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Notes">
            <div className="flex gap-2">
              <input
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Add an internal note…"
                className={cx(inputCls, "h-9 py-0")}
                onKeyDown={(e) => e.key === "Enter" && noteBody.trim() && addNote.mutate()}
              />
              <Button size="sm" variant="subtle" disabled={!noteBody.trim() || addNote.isPending}>Add</Button>
            </div>
            <ul className="mt-4 space-y-2">
              {(notesQ.data ?? []).map((n) => (
                <li key={n.id} className={cx("rounded-lg px-3 py-2.5", n.pinned ? "border border-amber-500/25 bg-amber-500/[0.07]" : "bg-paper-100")}>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-paper-800">
                    {n.body.replace(/\*\*/g, "")}
                  </p>
                  <p className="mt-1 text-[11px] text-paper-500">{n.authorName ?? "system"} · {timeAgo(n.createdAt)}</p>
                </li>
              ))}
              {!notesQ.data?.length && <li className="text-sm text-paper-500">No notes yet.</li>}
            </ul>
          </Panel>

          <Panel title="Timeline">
            <ul className="relative space-y-4 border-l border-paper-900/[0.11] pl-5">
              {(activityQ.data?.items ?? []).map((a) => (
                <li key={a.id} className="relative">
                  <span
                    className={cx(
                      "absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white",
                      a.actor === "ai" ? "bg-violet-400" : a.actor === "user" ? "bg-brand-500" : "bg-paper-300",
                    )}
                  />
                  <div className="flex items-start gap-2 text-sm">
                    {a.actor === "ai"
                      ? <IconBot width={13} height={13} className="mt-0.5 shrink-0 text-violet-600" />
                      : <IconUser width={13} height={13} className="mt-0.5 shrink-0 text-brand-700" />}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ActivityTypeBadge type={a.type} />
                        <span className="text-[11px] text-paper-500">{timeAgo(a.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-paper-900">{a.summary}</p>
                      <ActivityDetail data={a.data} type={a.type} />
                    </div>
                  </div>
                </li>
              ))}
              {!activityQ.data?.items.length && <li className="text-sm text-paper-500">No activity.</li>}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <CompanyThesisScreen companyId={id!} tags={c.tags} />
          <CompanyDiligenceTasks companyId={id!} />
          <CompanyWorkflowsStrip />
          <div className="panel p-3.5">
            <h2 className="mb-3 text-[13px] font-medium text-paper-800">Contacts</h2>
            {contactsQ.data?.length ? (
              <ul className="space-y-3">
                {contactsQ.data.map((ct) => (
                  <li key={ct.id} className="flex items-start gap-2.5">
                    <Avatar name={ct.name} size={28} />
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-paper-900">
                        {ct.name}
                        {ct.isFounder && <Badge tone="purple">founder</Badge>}
                      </p>
                      {ct.email && <p className="truncate text-[11px] text-paper-500">{ct.email}</p>}
                      {ct.title && <p className="truncate text-[11px] text-paper-600">{ct.title}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-paper-500">—</p>
            )}
          </div>
          <div className="panel p-5">
            <h3 className="mb-3 text-sm font-semibold text-paper-900">Team connections</h3>
            {(relQ.data ?? []).length ? (
              <ul className="space-y-2.5 text-[13px]">
                {(relQ.data ?? []).map((r) => (
                  <li key={r.contactEmail}>
                    <span className="font-medium text-paper-800">{r.teamMemberName ?? "Team"}</span>
                    <span className="text-paper-400"> ↔ </span>
                    <span className="text-paper-700">{r.contactEmail}</span>
                    <p className="text-[11px] text-paper-500">
                      {r.interactionCount} interaction{r.interactionCount === 1 ? "" : "s"} · last {timeAgo(r.lastInteractionAt)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-paper-500">No email history yet.</p>
            )}
          </div>

          <div className="panel p-5">
            <h3 className="mb-2 text-sm font-semibold text-paper-900">Merge duplicate</h3>
            <p className="mb-2 text-[11px] text-paper-600">Fold another record into this one (docs and notes move here).</p>
            <div className="flex gap-2">
              <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)} className="flex-1">
                <option value="">Pick company…</option>
                {(allCompaniesQ.data?.items ?? [])
                  .filter((c0: { id: string; name: string }) => c0.id !== id)
                  .map((c0: { id: string; name: string }) => (
                    <option key={c0.id} value={c0.id}>{c0.name}</option>
                  ))}
              </Select>
              <Button size="sm" variant="outline" disabled={!mergeInto || doMerge.isPending} onClick={() => doMerge.mutate()}>
                Merge
              </Button>
            </div>
          </div>


          {companyQ.isLoading && <Spinner className="mx-auto" />}
        </aside>
      </div>

      <Modal open={!!thesis} onClose={() => setThesis(null)} title={`Investment memo — ${c.name}`} wide>
        <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-paper-100 p-4 font-sans text-[13px] leading-relaxed text-paper-800">
          {thesis?.memo}
        </pre>
      </Modal>

      <Modal open={shareOpen} onClose={() => setShareOpen(false)} title={`Share "${c.name}"`} wide>
        <SharePanel
          companyId={id!}
          fieldKeys={Object.keys(c.fields)}
          links={companyLinks}
          onCreate={(p) => createLink.mutate(p)}
          onRevoke={(lid) => revokeLink.mutate(lid)}
          creating={createLink.isPending}
        />
      </Modal>
    </div>
  );
}

interface PersonDraft {
  key: string;
  name: string;
  firm: string;
  email: string;
  occurredAt: string | null;
}

function personFrom(p: Participant | null | undefined, fallbackKey: string): PersonDraft {
  return {
    key: p?.id ?? fallbackKey,
    name: p?.name ?? "",
    firm: p?.firm ?? "",
    email: p?.email ?? "",
    occurredAt: p?.occurredAt ?? null,
  };
}

function personPayload(draft: PersonDraft): { error: string } | { value: { name: string; firm: string | null; email: string | null; occurredAt?: string } } | null {
  const name = draft.name.trim();
  const firm = draft.firm.trim();
  const email = draft.email.trim();
  if (!name && !firm && !email) return null;
  if (!name) return { error: "Name is required." };
  if (email && !email.includes("@")) return { error: "Enter a valid email or leave it blank." };
  return {
    value: {
      name,
      firm: firm || null,
      email: email || null,
      ...(draft.occurredAt ? { occurredAt: draft.occurredAt } : {}),
    },
  };
}

function SyndicatePanel({
  company,
  saving,
  error,
  onPatch,
}: {
  company: Company;
  saving: boolean;
  error: string | null;
  onPatch: (patch: Record<string, unknown>) => void;
}) {
  const [roundLabel, setRoundLabel] = useState(company.roundLabel ?? "");
  const [status, setStatus] = useState(company.syndicateStatus ?? "");
  const [invested, setInvested] = useState(company.firmInvested == null ? "" : company.firmInvested ? "true" : "false");
  const [submitter, setSubmitter] = useState<PersonDraft>(() => personFrom(company.submittedBy, "submitter"));
  const [votes, setVotes] = useState<PersonDraft[]>(() => (company.upvoters ?? []).map((v) => personFrom(v, v.id)));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setRoundLabel(company.roundLabel ?? "");
    setStatus(company.syndicateStatus ?? "");
    setInvested(company.firmInvested == null ? "" : company.firmInvested ? "true" : "false");
    setSubmitter(personFrom(company.submittedBy, "submitter"));
    setVotes((company.upvoters ?? []).map((v) => personFrom(v, v.id)));
  }, [company]);

  const saveRound = () => {
    setLocalError(null);
    onPatch({
      roundLabel: roundLabel.trim() || null,
      syndicateStatus: status || null,
      firmInvested: invested === "" ? null : invested === "true",
    });
  };

  const saveSubmitter = () => {
    const parsed = personPayload(submitter);
    if (parsed && "error" in parsed) {
      setLocalError(parsed.error);
      return;
    }
    setLocalError(null);
    onPatch({ submittedBy: parsed?.value ?? null });
  };

  const saveVotes = () => {
    const next = [];
    for (const vote of votes) {
      const parsed = personPayload(vote);
      if (parsed && "error" in parsed) {
        setLocalError(parsed.error);
        return;
      }
      if (parsed?.value) next.push(parsed.value);
    }
    setLocalError(null);
    onPatch({ upvoters: next });
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-paper-900/[0.08] bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-paper-900/[0.06] px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-paper-400">Syndicate</p>
          <label className="mt-2 block text-[11px] font-medium text-paper-500">
            Round as written
            <input
              value={roundLabel}
              onChange={(e) => setRoundLabel(e.target.value)}
              placeholder="$6M Seed"
              className={cx(inputCls, "mt-1")}
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Choice
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              ["", "None"],
              ["queued", "Queued"],
              ["presented", "Presented"],
            ]}
          />
          <Choice
            label="Firm invested"
            value={invested}
            onChange={setInvested}
            options={[
              ["", "Unknown"],
              ["false", "No"],
              ["true", "Yes"],
            ]}
          />
          <Button size="sm" variant="outline" disabled={saving} onClick={saveRound}>
            Save round
          </Button>
        </div>
      </div>
      <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
        <div className="border-b border-paper-900/[0.06] px-5 py-4 lg:border-b-0 lg:border-r">
          <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-paper-400">Submitted by</p>
          <PersonFields draft={submitter} onChange={setSubmitter} />
          <Button size="sm" variant="outline" className="mt-2" disabled={saving} onClick={saveSubmitter}>
            Save submitter
          </Button>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-paper-400">Upvotes</p>
            <button
              type="button"
              className="text-[12px] font-semibold text-brand-700 hover:underline"
              onClick={() =>
                setVotes((prev) => [...prev, { key: `new-${Date.now()}`, name: "", firm: "", email: "", occurredAt: null }])
              }
            >
              Add vote
            </button>
          </div>
          {votes.length === 0 ? (
            <p className="mt-2 text-[13px] text-paper-400">No votes yet</p>
          ) : (
            <ul className="mt-2 space-y-3">
              {votes.map((vote) => (
                <li key={vote.key} className="rounded-lg border border-paper-900/[0.06] px-3 py-2">
                  <PersonFields
                    draft={vote}
                    onChange={(next) => setVotes((prev) => prev.map((v) => (v.key === vote.key ? next : v)))}
                  />
                  <div className="mt-1 flex items-center justify-between">
                    {vote.occurredAt ? (
                      <span className="text-[11px] text-paper-400">{timeAgo(vote.occurredAt)}</span>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className="text-[12px] font-medium text-red-600 hover:underline"
                      onClick={() => setVotes((prev) => prev.filter((v) => v.key !== vote.key))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Button size="sm" variant="outline" className="mt-3" disabled={saving} onClick={saveVotes}>
            Save votes
          </Button>
        </div>
      </div>
      {(localError || error) && <p className="border-t border-red-100 bg-red-50 px-5 py-2 text-[12px] text-red-700">{localError || error}</p>}
    </section>
  );
}

function PersonFields({ draft, onChange }: { draft: PersonDraft; onChange: (next: PersonDraft) => void }) {
  return (
    <div className="mt-2 grid gap-1.5">
      <input
        value={draft.name}
        onChange={(e) => onChange({ ...draft, name: e.target.value })}
        placeholder="Name"
        aria-label="Name"
        className={inputCls}
      />
      <input
        value={draft.firm}
        onChange={(e) => onChange({ ...draft, firm: e.target.value })}
        placeholder="Firm"
        aria-label="Firm"
        className={inputCls}
      />
      <input
        value={draft.email}
        onChange={(e) => onChange({ ...draft, email: e.target.value })}
        placeholder="Email"
        aria-label="Email"
        className={inputCls}
      />
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="text-[11px] font-medium text-paper-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cx(inputCls, "mt-1 h-8")}
      >
        {options.map(([v, text]) => (
          <option key={v || "empty"} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function Meta({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-paper-400">{label}</p>
      <p className={cx("num mt-0.5 text-[13px] font-medium", accent ? "text-brand-700" : "text-paper-900")}>{value}</p>
    </div>
  );
}

function ActivityTypeBadge({ type }: { type: string }) {
  const label =
    type === "workflow.run"
      ? "workflow"
      : type === "agent_run.completed"
        ? "agent"
        : type === "note.added"
          ? "note"
          : type === "deal.stage_changed"
            ? "stage"
            : type.replace(/\./g, " ");
  const tone =
    type.startsWith("workflow") || type.startsWith("agent")
      ? "indigo"
      : type === "deal.stage_changed"
        ? "amber"
        : "slate";
  return <Badge tone={tone}>{label}</Badge>;
}

function ActivityDetail({
  data,
  type,
}: {
  data?: Record<string, unknown> | null;
  type: string;
}) {
  if (!data) return null;
  const tasks = Array.isArray(data.tasks) ? (data.tasks as string[]) : null;
  const spaceName = typeof data.spaceName === "string" ? data.spaceName : null;
  const output = data.output && typeof data.output === "object" ? (data.output as Record<string, unknown>) : null;
  const createdFromOutput = Array.isArray(output?.createdTasks)
    ? (output!.createdTasks as Array<string | { title?: string }>).map((t) =>
        typeof t === "string" ? t : String(t.title ?? ""),
      ).filter(Boolean)
    : null;
  const checklist = tasks?.length ? tasks : createdFromOutput;
  const steps = Array.isArray(data.steps)
    ? (data.steps as Array<{ type?: string; detail?: string; status?: string }>)
    : null;

  if (checklist?.length) {
    return (
      <ul className="mt-1.5 space-y-0.5 rounded-md bg-paper-100 px-2.5 py-2 text-[12px] text-paper-700">
        {spaceName && <li className="mb-1 font-medium text-paper-800">In {spaceName}</li>}
        {checklist.slice(0, 8).map((t) => (
          <li key={t}>☐ {t}</li>
        ))}
        {checklist.length > 8 && <li className="text-paper-400">+{checklist.length - 8} more</li>}
      </ul>
    );
  }
  if (type === "agent_run.completed" && output?.recommendation) {
    return (
      <div className="mt-1.5 rounded-md bg-paper-100 px-2.5 py-2 text-[12px] text-paper-700">
        <p className="font-medium text-paper-900">
          {String(output.recommendation).toUpperCase()}
          {output.fitScore != null ? ` · fit ${String(output.fitScore)}/100` : ""}
        </p>
        {typeof output.summary === "string" && (
          <p className="mt-1 text-paper-600">{output.summary}</p>
        )}
      </div>
    );
  }
  if (type === "workflow.run" && steps?.length) {
    return (
      <ul className="mt-1 space-y-0.5 text-[11px] text-paper-500">
        {steps.map((s, i) => (
          <li key={i}>
            {s.status === "ok" ? "→" : "×"} {s.detail ?? s.type}
          </li>
        ))}
      </ul>
    );
  }
  return null;
}

function CompanyDiligenceTasks({ companyId }: { companyId: string }) {
  const activityQ = useQuery({
    queryKey: ["activity", companyId],
    queryFn: () => api.get<{ items: Activity[] }>(`/activity?companyId=${companyId}&limit=30`),
  });
  const spacesQ = useQuery({
    queryKey: ["spaces"],
    queryFn: () => api.get<SpaceSummary[]>("/spaces"),
  });
  const space = (spacesQ.data ?? []).find((s) => s.companyId === companyId);
  const tasksQ = useQuery({
    queryKey: ["tasks", space?.id],
    queryFn: () => api.get<{ items: TaskItem[] }>(`/tasks?spaceId=${space!.id}&status=open&limit=20`),
    enabled: !!space?.id,
  });

  const fromTasks = tasksQ.data?.items ?? [];
  // Fallback: pull titles from the latest agent/note activity if spaces lag behind the run
  const fromActivity: string[] = [];
  for (const a of activityQ.data?.items ?? []) {
    const titles = Array.isArray(a.data?.tasks) ? (a.data!.tasks as string[]) : null;
    const created = Array.isArray((a.data?.output as { createdTasks?: unknown } | undefined)?.createdTasks)
      ? ((a.data!.output as { createdTasks: Array<string | { title?: string }> }).createdTasks).map((t) =>
          typeof t === "string" ? t : String(t.title ?? ""),
        )
      : null;
    const list = titles ?? created;
    if (list?.length) {
      for (const t of list) if (t && !fromActivity.includes(t)) fromActivity.push(t);
      break;
    }
  }
  const pending = (activityQ.data?.items ?? []).some(
    (a) => a.type === "agent_run.queued" || (a.type === "workflow.run" && /Checklist Builder/i.test(a.summary)),
  );
  const items = fromTasks.length
    ? fromTasks.map((t) => ({ id: t.id, title: t.title }))
    : fromActivity.map((t, i) => ({ id: `act-${i}`, title: t }));

  if (!items.length && !pending && !spacesQ.isLoading && !tasksQ.isLoading) return null;

  return (
    <div className="panel p-3.5">
      <h2 className="mb-2 text-[13px] font-medium text-paper-800">
        Diligence checklist
        {space ? <span className="ml-1 font-normal text-paper-400">· {space.name}</span> : null}
      </h2>
      {!items.length && pending ? (
        <p className="text-[12.5px] text-paper-500">Building checklist…</p>
      ) : tasksQ.isLoading || spacesQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <ul className="space-y-1.5 text-[12.5px] text-paper-800">
          {items.map((t) => (
            <li key={t.id} className="flex gap-2">
              <span className="text-paper-400">☐</span>
              <span>{t.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CompanyThesisScreen({
  companyId,
  tags,
}: {
  companyId: string;
  tags?: string[];
}) {
  const activityQ = useQuery({
    queryKey: ["activity", companyId],
    queryFn: () => api.get<{ items: Activity[] }>(`/activity?companyId=${companyId}&limit=30`),
  });
  const stamp = parseScreenTag(tags);
  const screenActivity = (activityQ.data?.items ?? []).find(
    (a) =>
      a.type === "agent_run.completed" &&
      a.data?.output &&
      typeof a.data.output === "object" &&
      "recommendation" in (a.data.output as object),
  );
  const output =
    screenActivity?.data?.output && typeof screenActivity.data.output === "object"
      ? (screenActivity.data.output as Record<string, unknown>)
      : null;
  const recommendation =
    (typeof output?.recommendation === "string" ? output.recommendation : stamp?.recommendation) as
      | ScreenRec
      | undefined;
  const fitScore =
    typeof output?.fitScore === "number"
      ? output.fitScore
      : stamp?.fitScore ?? null;

  if (!recommendation && !activityQ.isLoading) return null;

  return (
    <div className="panel p-3.5">
      <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-medium text-paper-800">
        <IconBot width={13} height={13} /> Thesis screen
      </h2>
      {activityQ.isLoading && !recommendation ? (
        <Skeleton className="h-12 w-full" />
      ) : recommendation ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <ScreenBadge
              recommendation={recommendation}
              fitScore={typeof fitScore === "number" ? fitScore : null}
            />
            <Link to="/app/automations" className="text-[11px] font-medium text-brand-700 hover:underline">
              Agents
            </Link>
          </div>
          {typeof output?.summary === "string" && (
            <p className="text-[12px] leading-snug text-paper-600">{output.summary}</p>
          )}
          {Array.isArray(output?.reasons) && (output.reasons as unknown[]).length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-paper-500">
              {(output.reasons as unknown[]).slice(0, 3).map((r, i) => (
                <li key={i}>+ {String(r)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Compact pointer to event rules — not a second workflows editor. */
function CompanyWorkflowsStrip() {
  return (
    <div className="panel p-3.5">
      <h2 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium text-paper-800">
        <IconBot width={13} height={13} /> Agents & workflows
      </h2>
      <p className="mb-2 text-[12px] leading-snug text-paper-500">
        New companies are enriched and thesis-screened automatically. Stage moves can kick off diligence.
      </p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Link to="/app/workflows" className="text-[12px] font-medium text-brand-700 hover:underline">
          Workflows →
        </Link>
        <Link to="/app/automations" className="text-[12px] font-medium text-brand-700 hover:underline">
          Agents →
        </Link>
      </div>
    </div>
  );
}

/* ── share links panel (Roulette "share deals, not your whole CRM") ── */

interface ShareLink {
  id: string;
  token: string;
  url: string;
  companyId: string;
  title: string;
  attributes: string[] | null;
  includeDocuments: boolean;
  hasPassword: boolean;
  expiresAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  secret?: string;
}

function SharePanel({
  companyId: _companyId,
  fieldKeys,
  links,
  onCreate,
  onRevoke,
  creating,
}: {
  companyId: string;
  fieldKeys: string[];
  links: ShareLink[];
  onCreate: (payload: Record<string, unknown>) => void;
  onRevoke: (linkId: string) => void;
  creating: boolean;
}) {
  const mine = links.filter((l) => !l.revokedAt);
  const [attrs, setAttrs] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [includeDocs, setIncludeDocs] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <form
        className="space-y-3 rounded-xl border border-paper-900/[0.09] bg-paper-100 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate({
            title: `Shared record`,
            attributes: attrs.length ? attrs : null,
            includeDocuments: includeDocs,
            password: password || undefined,
            expiresAt: expiresDays
              ? new Date(Date.now() + Number(expiresDays) * 86_400_000).toISOString()
              : undefined,
          });
          setPassword("");
          setExpiresDays("");
        }}
      >
        <p className="text-xs font-semibold uppercase tracking-wider text-brand-700">Create share link</p>
        <div>
          <span className="mb-1 block text-xs text-paper-600">Visible attributes</span>
          <div className="flex flex-wrap gap-1.5">
            {fieldKeys.map((k) => (
              <label key={k} className={cx(
                "cursor-pointer rounded-full border px-2.5 py-1 text-xs transition",
                attrs.includes(k) ? "border-brand-400 bg-brand-50 text-brand-700" : "border-paper-900/[0.12] text-paper-600",
              )}>
                <input
                  type="checkbox"
                  className="hidden"
                  checked={attrs.includes(k)}
                  onChange={() =>
                    setAttrs((cur) => cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k])
                  }
                />
                {k}
              </label>
            ))}
            {!fieldKeys.length && <span className="text-xs text-paper-500">No custom fields defined.</span>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Password (optional)">
            <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 4 chars" />
          </Field>
          <Field label="Expires in (days, optional)">
            <input className={inputCls} value={expiresDays} onChange={(e) => setExpiresDays(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 14" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-paper-700">
          <input type="checkbox" checked={includeDocs} onChange={(e) => setIncludeDocs(e.target.checked)} />
          Include decks & documents
        </label>
        <Button type="submit" size="sm" disabled={creating}>{creating ? <Spinner /> : null} Create link</Button>
      </form>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-paper-600">
          Active links ({mine.length})
        </h4>
        <ul className="space-y-2">
          {mine.map((l) => (
            <li key={l.id} className="rounded-lg border border-paper-900/[0.09] px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-paper-800">{l.title}</span>
                <Badge tone="slate">👁 {l.viewCount} views</Badge>
              </div>
              <p className="mt-1 break-all text-paper-500">{l.url}</p>
              <p className="mt-0.5 text-paper-400">
                {l.hasPassword && "🔒 password · "}
                {l.expiresAt && `expires ${new Date(l.expiresAt).toLocaleDateString()} · `}
                attrs: {(l.attributes ?? ["defaults"]).join(", ")}
                {l.includeDocuments && " · docs included"}
                {l.lastViewedAt && ` · last viewed ${timeAgo(l.lastViewedAt)}`}
              </p>
              <div className="mt-1.5 flex gap-2">
                <button
                  className="font-medium text-brand-600 hover:underline"
                  onClick={() => {
                    const publicUrl = `${window.location.origin}/public/share/${l.token}`;
                    void navigator.clipboard.writeText(publicUrl);
                    setCopied(l.id);
                    setTimeout(() => setCopied(null), 1500);
                  }}
                >
                  {copied === l.id ? "Copied!" : "Copy public URL"}
                </button>
                <button className="text-red-500 hover:underline" onClick={() => onRevoke(l.id)}>Revoke</button>
              </div>
            </li>
          ))}
          {!mine.length && <li className="text-xs text-paper-500">No active links.</li>}
        </ul>
      </div>
    </div>
  );
}
