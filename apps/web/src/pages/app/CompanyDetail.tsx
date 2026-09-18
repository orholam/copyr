import { useState } from "react";
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
  fields: Record<string, string | number | boolean | string[] | null>;
}
interface Deal {
  id: string;
  stageId: string;
  roundStage: string | null;
  askAmount: number | null;
}
interface Stage { id: string; name: string; kind: string }
interface Document_ {
  id: string; name: string; parseStatus: string; pageCount: number | null; createdAt: string; sourceUrl: string | null;
}
interface Note { id: string; body: string; authorName?: string | null; createdAt: string; pinned: boolean }
interface Activity { id: string; type: string; summary: string; actor: string; createdAt: string }
interface Contact { id: string; name: string; email: string | null; title: string | null; isFounder: boolean }

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
  const dealsQ = useQuery({
    queryKey: ["deals", "company", id],
    queryFn: () => api.get<{ items: Deal[] }>(`/deals?limit=10&q=${encodeURIComponent(companyQ.data?.name ?? "")}`),
    enabled: !!id && !!companyQ.data?.name,
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

  const addNote = useMutation({
    mutationFn: () => api.post("/notes", { companyId: id, body: noteBody }),
    onSuccess: () => {
      setNoteBody("");
      void qc.invalidateQueries({ queryKey: ["notes", id] });
      void qc.invalidateQueries({ queryKey: ["activity", id] });
    },
  });

  if (!companyQ.data) {
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
  const deal = dealsQ.data?.items[0];
  const allStages = stagesQ.data?.flatMap((p) => p.stages) ?? [];
  const stage = deal && allStages.find((s) => s.id === deal.stageId);
  const fieldEntries = Object.entries(c.fields).filter(([, v]) => v !== null && v !== undefined);

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
            {stage && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-paper-900/[0.11] bg-paper-100 px-2 py-1 text-xs font-medium text-paper-800">
                <span className={cx("h-1.5 w-1.5 rounded-full", stage.kind === "won" ? "bg-emerald-400/80" : stage.kind === "lost" ? "bg-red-400/80" : "bg-brand-400")} />
                {stage.name}
              </span>
            )}
            <Badge tone={c.status === "portfolio" ? "green" : c.status === "active" ? "slate" : "purple"}>{c.status}</Badge>
          </div>
        </div>

        {deal && (
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-paper-900/[0.09] pt-3.5">
            {deal.roundStage && <Meta label="Round" value={deal.roundStage} />}
            {deal.askAmount != null && <Meta label="Ask" value={money(deal.askAmount)} accent />}
          </div>
        )}
      </header>

      {c.description && (
        <p className="mt-4 max-w-2xl text-[13px] leading-relaxed text-paper-600">{c.description}</p>
      )}

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
            {(c.tags ?? []).map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-paper-200/70 px-2 py-0.5 text-[11px] font-medium text-paper-700">
                #{t}
                <button className="text-paper-400 transition hover:text-red-500" onClick={() => saveTags.mutate((c.tags ?? []).filter((x) => x !== t))}>×</button>
              </span>
            ))}
            <input
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newTag.trim()) {
                  saveTags.mutate([...(c.tags ?? []), newTag.trim().toLowerCase()]);
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
                  <p className="text-sm leading-relaxed text-paper-800">{n.body}</p>
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
                  <span className="flex items-start gap-2 text-sm">
                    {a.actor === "ai"
                      ? <IconBot width={13} height={13} className="mt-0.5 shrink-0 text-violet-600" />
                      : <IconUser width={13} height={13} className="mt-0.5 shrink-0 text-brand-700" />}
                    <span>
                      <span className="text-paper-900">{a.summary}</span>{" "}
                      <span className="text-[11px] text-paper-500">{timeAgo(a.createdAt)}</span>
                    </span>
                  </span>
                </li>
              ))}
              {!activityQ.data?.items.length && <li className="text-sm text-paper-500">No activity.</li>}
            </ul>
          </Panel>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
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
            <p className="mb-2 text-[11px] text-paper-600">Fold another company record into this one (deals, docs, notes move here).</p>
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

function Meta({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-paper-400">{label}</p>
      <p className={cx("num mt-0.5 text-[13px] font-medium", accent ? "text-brand-700" : "text-paper-900")}>{value}</p>
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
