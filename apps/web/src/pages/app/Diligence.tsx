import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Panel,
  Skeleton,
  Spinner,
  inputCls,
  timeAgo,
} from "../../components/ui";
import { IconDoc, IconPlus, IconSpark } from "../../components/icons";

interface Vault {
  id: string;
  name: string;
  description: string | null;
  companyId: string | null;
  dealId: string | null;
  status: string;
  documentCount: number;
  parsedDocumentCount: number;
  reviewTableCount: number;
  createdAt: string;
}

interface ReviewTable {
  id: string;
  vaultId: string;
  name: string;
  instruction: string | null;
  columns: Array<{ key: string; label: string; type: string }>;
  status: "pending" | "running" | "completed" | "failed";
  rowCount: number;
  error: string | null;
  creditsUsed: number;
  createdAt: string;
  completedAt: string | null;
}

const STATUS_TONE = {
  completed: "green",
  running: "amber",
  pending: "slate",
  failed: "red",
} as const;

export default function Diligence() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showTable, setShowTable] = useState(false);

  const vaultsQ = useQuery({ queryKey: ["vaults"], queryFn: () => api.get<Vault[]>("/vaults"), refetchInterval: 4000 });
  const detailQ = useQuery({
    queryKey: ["vault", selected],
    queryFn: () =>
      api.get<{ vault: Vault; documents: Array<{ id: string; name: string; parseStatus: string }>; tables: ReviewTable[] }>(
        `/vaults/${selected}`,
      ),
    enabled: !!selected,
    refetchInterval: 4000,
  });

  const createVault = useMutation({
    mutationFn: (body: { name: string; description?: string }) => api.post("/vaults", body),
    onSuccess: () => {
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["vaults"] });
    },
  });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Diligence"
        subtitle="Bulk document review — one query across every document in the room"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <IconPlus width={14} height={14} /> New vault
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <div className="space-y-2">
          {vaultsQ.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !vaultsQ.data?.length ? (
            <EmptyState
              icon={<IconDoc width={18} height={18} />}
              title="No vaults yet"
              hint="Group a data room into a vault, then extract structured terms across all of it."
            />
          ) : (
            vaultsQ.data.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelected(v.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  selected === v.id
                    ? "border-brand-500/40 bg-brand-500/[0.08]"
                    : "border-paper-900/[0.09] bg-paper-100 hover:border-paper-900/[0.16]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-paper-900">{v.name}</span>
                  <Badge tone={v.parsedDocumentCount === v.documentCount && v.documentCount > 0 ? "green" : "slate"}>
                    {v.parsedDocumentCount}/{v.documentCount} parsed
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-paper-500">
                  {v.reviewTableCount} review table{v.reviewTableCount === 1 ? "" : "s"} · {timeAgo(v.createdAt)}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {detailQ.data ? (
            <>
              <Panel
                title={detailQ.data.vault.name}
                icon={<IconDoc width={15} height={15} />}
                actions={
                  <Button size="sm" variant="outline" onClick={() => setShowTable(true)}>
                    <IconSpark width={13} height={13} /> Review table
                  </Button>
                }
              >
                <div className="divide-y divide-paper-900/[0.06]">
                  {detailQ.data.documents.map((d) => (
                    <div key={d.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="truncate text-paper-800">{d.name}</span>
                      <Badge tone={d.parseStatus === "parsed" ? "green" : d.parseStatus === "failed" ? "red" : "amber"}>
                        {d.parseStatus}
                      </Badge>
                    </div>
                  ))}
                  {!detailQ.data.documents.length && (
                    <p className="py-3 text-xs text-paper-500">Upload documents on a company/deal, then attach them here.</p>
                  )}
                </div>
              </Panel>

              {detailQ.data.tables.map((t) => (
                <ReviewTableView key={t.id} table={t} />
              ))}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-paper-900/[0.11] p-10 text-center text-sm text-paper-500">
              Select a vault — or create one — to run structured extraction across the data room.
            </div>
          )}

          <ResearchBox />
        </div>
      </div>

      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="New diligence vault">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              createVault.mutate({
                name: String(fd.get("name") ?? ""),
                description: String(fd.get("description") ?? "") || undefined,
              });
            }}
            className="space-y-3"
          >
            <Field label="Name">
              <input name="name" required autoFocus className={inputCls} placeholder="Nimbus Robotics — data room" />
            </Field>
            <Field label="Description" hint="What this room covers">
              <textarea name="description" className={inputCls} rows={2} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                {createVault.isPending ? <Spinner /> : "Create"}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showTable && selected && (
        <ReviewTableModal
          vaultId={selected}
          onClose={() => setShowTable(false)}
          onCreated={() => {
            setShowTable(false);
            qc.invalidateQueries({ queryKey: ["vault", selected] });
          }}
        />
      )}
    </div>
  );
}

function ReviewTableModal({
  vaultId,
  onClose,
  onCreated,
}: {
  vaultId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [cols, setCols] = useState<Array<{ key: string; label: string; type: string }>>([
    { key: "counterparty", label: "Counterparty", type: "text" },
    { key: "value_usd", label: "Contract value", type: "currency" },
    { key: "change_of_control", label: "Change-of-control clause", type: "boolean" },
  ]);

  const run = useMutation({
    mutationFn: (body: { name: string; instruction?: string }) =>
      api.post(`/vaults/${vaultId}/review-tables`, {
        ...body,
        columns: cols.filter((c) => c.key && c.label),
        waitForCompletion: true,
      }),
    onSuccess: onCreated,
  });

  return (
    <Modal open onClose={onClose} title="Run a review table">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run.mutate({
            name: String(fd.get("name") ?? ""),
            instruction: String(fd.get("instruction") ?? "") || undefined,
          });
        }}
        className="space-y-3"
      >
        <Field label="Table name">
          <input name="name" required className={inputCls} defaultValue="Customer contract terms" />
        </Field>
        <Field label="Instruction" hint="Optional guidance for the extraction">
          <input name="instruction" className={inputCls} placeholder="Focus on enterprise agreements over $50k" />
        </Field>
        <Field label="Columns">
          <div className="space-y-2">
            {cols.map((c, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${inputCls} flex-1`}
                  value={c.label}
                  onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, label: e.target.value, key: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || x.key } : x)))}
                  placeholder="Label"
                />
                <select
                  className={`${inputCls} w-28`}
                  value={c.type}
                  onChange={(e) => setCols(cols.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}
                >
                  {["text", "number", "currency", "date", "boolean"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
                <button type="button" className="text-paper-500 hover:text-red-400" onClick={() => setCols(cols.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs font-medium text-brand-700 hover:underline"
              onClick={() => setCols([...cols, { key: "", label: "", type: "text" }])}
            >
              + Add column
            </button>
          </div>
        </Field>
        <p className="rounded-lg bg-paper-100 px-3 py-2 text-[11px] text-paper-500">
          Every parsed document in the vault is reviewed; each row cites the quotes it was extracted from. Locked rows survive reruns.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            {run.isPending ? <Spinner /> : "Extract"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ReviewTableView({ table }: { table: ReviewTable }) {
  const q = useQuery({
    queryKey: ["review-table", table.id],
    queryFn: () =>
      api.get<{
        table: ReviewTable;
        rows: Array<{
          id: string;
          documentName?: string | null;
          data: Record<string, string | number | boolean | null>;
          citations: Array<{ quote: string }>;
          confidence: number | null;
        }>;
      }>(`/review-tables/${table.id}`),
    refetchInterval: table.status === "running" || table.status === "pending" ? 3000 : false,
  });

  return (
    <Panel title={`Table · ${table.name}`} icon={<IconSpark width={15} height={15} />}>
      <div className="mb-3 flex items-center gap-2">
        <Badge tone={STATUS_TONE[table.status]}>{table.status}</Badge>
        {table.status === "completed" && (
          <span className="text-[11px] text-paper-500">{q.data?.rows.length ?? 0} rows · {table.creditsUsed} credits</span>
        )}
      </div>

      {table.error && <p className="mb-2 text-xs text-red-400">{table.error}</p>}

      {!!q.data?.rows.length && (
        <div className="-mx-1 overflow-x-auto px-1">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-paper-900/[0.11] text-left text-[10px] uppercase tracking-wider text-paper-500">
                <th className="py-1.5 pr-3 font-medium">Document</th>
                {Object.keys(q.data.rows[0]!.data).map((k) => (
                  <th key={k} className="py-1.5 pr-3 font-medium">{k.replace(/_/g, " ")}</th>
                ))}
                <th className="py-1.5 font-medium">Conf.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-900/[0.05]">
              {q.data.rows.map((r) => (
                <tr key={r.id} className="align-top" title={r.citations[0]?.quote}>
                  <td className="max-w-[160px] truncate py-2 pr-3 text-paper-700">{r.documentName}</td>
                  {Object.keys(r.data).map((k) => (
                    <td key={k} className="max-w-[140px] truncate py-2 pr-3 text-paper-800">
                      {r.data[k] === null || r.data[k] === undefined ? <span className="text-paper-400">—</span> : String(r.data[k])}
                    </td>
                  ))}
                  <td className="num py-2 text-paper-600">{r.confidence != null ? `${Math.round(r.confidence * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(table.status === "running" || table.status === "pending") && (
        <div className="flex items-center gap-2 text-xs text-paper-500">
          <Spinner className="h-3 w-3" /> reviewing every document in the vault…
        </div>
      )}
    </Panel>
  );
}

function ResearchBox() {
  const [question, setQuestion] = useState("");
  const ask = useMutation({
    mutationFn: () =>
      api.post<{
        answer: string;
        citations: Array<{ sourceName: string }>;
        confidence: number | null;
        creditsUsed: number;
      }>("/research/ask", { question }),
  });

  return (
    <Panel title="Ask the corpus" icon={<IconSpark width={15} height={15} />}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) ask.mutate();
        }}
        className="flex gap-2"
      >
        <input
          className={`${inputCls} flex-1`}
          placeholder="e.g. What do customer contracts say about change of control?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={ask.isPending}>
          {ask.isPending ? <Spinner /> : "Ask"}
        </Button>
      </form>

      {ask.isError && <p className="mt-2 text-xs text-red-400">{(ask.error as Error).message}</p>}

      {ask.data && (
        <div className="mt-3 rounded-lg bg-paper-100 p-3">
          <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-paper-800">{ask.data.answer}</pre>
          <div className="mt-2 flex flex-wrap gap-1">
            {ask.data.citations?.map((c, i) => (
              <Badge key={i} tone="indigo">
                {c.sourceName}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-wide text-paper-400">
            confidence {Math.round((ask.data.confidence ?? 0) * 100)}% · {ask.data.creditsUsed} credits
          </p>
        </div>
      )}
    </Panel>
  );
}
