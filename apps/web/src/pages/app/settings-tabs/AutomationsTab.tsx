import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { Badge, Button, Field as F, Modal, Select, Spinner, inputCls } from "../../../components/ui";

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: Array<{ field: string; op: string; value?: unknown }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  isEnabled: boolean;
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
}

interface Run {
  id: string;
  workflowName?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  steps: Array<{ actionIndex: number; type: string; status: string; detail?: string; at: string }>;
  error: string | null;
  createdAt: string;
}

const TRIGGERS = [
  ["deal.created", "Deal created"],
  ["deal.stage_changed", "Deal stage changed"],
  ["deal.updated", "Deal updated"],
  ["company.created", "Company created"],
  ["company.updated", "Company updated"],
  ["email.processed", "Email processed"],
  ["email.needs_review", "Email needs review"],
  ["document.parsed", "Document parsed"],
  ["extraction.completed", "AI extraction completed"],
  ["note.added", "Note added"],
  ["portfolio_update.created", "Portfolio update created"],
] as const;

const ACTION_TYPES = [
  ["add_note", "Add note"],
  ["move_deal", "Move deal to stage"],
  ["set_deal_fields", "Set deal fields"],
  ["set_company_fields", "Set company fields"],
  ["create_portfolio_update", "Create portfolio update"],
] as const;

const OPS = [
  ["eq", "equals"],
  ["neq", "not equals"],
  ["gt", ">"],
  ["gte", "≥"],
  ["lt", "<"],
  ["lte", "≤"],
  ["contains", "contains"],
  ["exists", "exists"],
] as const;

const emptyForm = {
  name: "",
  triggerEvent: "deal.created",
  conditions: [] as Array<{ field: string; op: string; value?: unknown }>,
  actions: [{ type: "add_note", config: { body: "" } }] as Workflow["actions"],
};

function statusTone(s: Run["status"]) {
  return s === "completed" ? "green" : s === "failed" ? "red" : s === "skipped" ? "slate" : "amber";
}

export default function AutomationsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<null | typeof emptyForm & { id?: string }>(null);
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  const workflowsQ = useQuery({ queryKey: ["workflows"], queryFn: () => api.get<Workflow[]>("/workflows") });
  const runsQ = useQuery({
    queryKey: ["workflow-runs"],
    queryFn: () => api.get<Run[]>("/workflow-runs?limit=30"),
    refetchInterval: 10_000,
  });

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown> & { id?: string }) =>
      payload.id
        ? api.patch(`/workflows/${payload.id}`, payload)
        : api.post("/workflows", payload),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["workflows"] });
      void qc.invalidateQueries({ queryKey: ["workflow-runs"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.patch(`/workflows/${id}`, { isEnabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["workflows"] }),
  });

  const test = useMutation({
    mutationFn: (id: string) => api.post<Record<string, unknown>>(`/workflows/${id}/test`),
    onSuccess: setTestResult,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-paper-500">
          Automations run on every matching event — WHEN it happens, IF conditions match, THEN actions execute.
        </p>
        <Button size="sm" onClick={() => setEditing(structuredClone(emptyForm))}>+ New automation</Button>
      </div>

      {/* workflow list */}
      {(workflowsQ.data ?? []).map((wf) => (
        <div key={wf.id} className="rounded-xl border border-paper-900/[0.12] bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-paper-800">{wf.name}</span>
              <Badge tone={wf.isEnabled ? "green" : "slate"}>{wf.isEnabled ? "active" : "paused"}</Badge>
              <Badge tone="indigo">{wf.runCount} runs</Badge>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => test.mutate(wf.id)} disabled={test.isPending}>
                {test.isPending ? <Spinner /> : "Test"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: wf.id, isEnabled: !wf.isEnabled })}>
                {wf.isEnabled ? "Pause" : "Enable"}
              </Button>
              <Button size="sm" variant="outline" onClick={() =>
                setEditing({
                  id: wf.id,
                  name: wf.name,
                  triggerEvent: wf.triggerEvent,
                  conditions: wf.conditions.map((c) => ({ ...c })),
                  actions: wf.actions.map((a) => ({ ...a, config: { ...a.config } })),
                })
              }>
                Edit
              </Button>
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => remove.mutate(wf.id)}>Delete</Button>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-paper-500">
            <b>When</b> {TRIGGERS.find(([v]) => v === wf.triggerEvent)?.[1] ?? wf.triggerEvent}
            {wf.conditions.length > 0 && (
              <> · <b>If</b>{" "}{wf.conditions.map((c) => `${c.field} ${c.op} ${String(c.value ?? "")}`).join(" AND ")}</>
            )}
            {" · "}
            <b>Then</b> {wf.actions.map((a) => ACTION_TYPES.find(([v]) => v === a.type)?.[1] ?? a.type).join(", ")}
          </p>
        </div>
      ))}
      {!workflowsQ.isLoading && !workflowsQ.data?.length && (
        <div className="rounded-xl border border-dashed border-paper-400 py-12 text-center text-sm text-paper-500">
          No automations yet — create one to let Copyr act on events for you.
        </div>
      )}

      {/* recent runs */}
      <h3 className="pt-4 text-sm font-semibold text-paper-700">Recent runs</h3>
      <div className="rounded-xl border border-paper-900/[0.12] bg-white divide-y divide-paper-900/[0.07] text-sm">
        {(runsQ.data ?? []).map((r) => (
          <details key={r.id} className="group px-4 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between">
              <span className="flex items-center gap-2">
                <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                <span className="text-paper-700">{r.workflowName}</span>
                {r.error && <span className="text-xs text-red-500">{r.error.slice(0, 60)}</span>}
              </span>
              <span className="text-xs text-paper-400">{new Date(r.createdAt).toLocaleTimeString()}</span>
            </summary>
            <ul className="mt-2 space-y-1 border-l border-paper-900/[0.12] pl-3 text-xs text-paper-500">
              {r.steps.length === 0 && <li>No steps executed.</li>}
              {r.steps.map((s) => (
                <li key={s.actionIndex}>
                  {s.status === "ok" ? "✅" : s.status === "error" ? "❌" : "⏭"} <b>{s.type}</b> {s.detail}
                </li>
              ))}
            </ul>
          </details>
        ))}
        {!runsQ.data?.length && <p className="px-4 py-3 text-paper-400">No runs yet.</p>}
      </div>

      {/* builder modal */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit automation" : "New automation"} wide>
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!editing.actions.length) return;
              save.mutate(editing as unknown as Record<string, never>);
            }}
          >
            <F label="Name"><input required className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></F>

            <div className="rounded-xl bg-paper-50 p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-700">When</p>
              <Select value={editing.triggerEvent} onChange={(e) => setEditing({ ...editing, triggerEvent: e.target.value })}>
                {TRIGGERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>

              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-brand-700">If (all must match)</p>
              <div className="space-y-2">
                {editing.conditions.map((cond, i) => (
                  <div key={i} className="grid grid-cols-[1fr_110px_1fr_auto] items-center gap-2">
                    <input placeholder="field (deal.askAmount)" className={inputCls} value={cond.field}
                      onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((c, j) => j === i ? { ...c, field: e.target.value } : c) })} />
                    <Select value={cond.op} onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((c, j) => j === i ? { ...c, op: e.target.value } : c) })}>
                      {OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Select>
                    <input placeholder="value" className={inputCls} value={String(cond.value ?? "")}
                      onChange={(e) => setEditing({ ...editing, conditions: editing.conditions.map((c, j) => j === i ? { ...c, value: e.target.value } : c) })} />
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ ...editing, conditions: editing.conditions.filter((_, j) => j !== i) })}>×</Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline"
                  onClick={() => setEditing({ ...editing, conditions: [...editing.conditions, { field: "", op: "eq", value: "" }] })}>
                  + condition
                </Button>
              </div>

              <p className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-brand-700">Then</p>
              <div className="space-y-3">
                {editing.actions.map((action, i) => (
                  <div key={i} className="rounded-lg border border-paper-900/[0.12] p-3">
                    <div className="flex items-center gap-2">
                      <Select value={action.type} className="max-w-xs"
                        onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((a, j) => j === i ? { ...a, type: e.target.value } : a) })}>
                        {ACTION_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </Select>
                      {editing.actions.length > 1 && (
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing({ ...editing, actions: editing.actions.filter((_, j) => j !== i) })}>×</Button>
                      )}
                    </div>
                    {action.type === "add_note" && (
                      <input className={inputCls + " mt-2"} placeholder="Note body — {{deal.company.name}} supported"
                        value={String(action.config.body ?? "")}
                        onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((a, j) => j === i ? { ...a, config: { body: e.target.value } } : a) })} />
                    )}
                    {action.type === "move_deal" && (
                      <input className={inputCls + " mt-2"} placeholder="Stage name (e.g. Due Diligence)"
                        value={String(action.config.stageName ?? "")}
                        onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((a, j) => j === i ? { ...a, config: { stageName: e.target.value } } : a) })} />
                    )}
                    {(action.type === "set_deal_fields" || action.type === "set_company_fields") && (
                      <input className={inputCls + " mt-2"} placeholder='Fields JSON e.g. {"conviction":"High"}'
                        value={JSON.stringify(action.config.fields ?? {})}
                        onChange={(e) => {
                          try { setEditing({ ...editing, actions: editing.actions.map((a, j) => j === i ? { ...a, config: { fields: JSON.parse(e.target.value || "{}") } } : a) }); } catch { /* keep typing */ }
                        }} />
                    )}
                    {action.type === "create_portfolio_update" && (
                      <input className={inputCls + " mt-2"} placeholder="Title template"
                        value={String(action.config.title ?? "")}
                        onChange={(e) => setEditing({ ...editing, actions: editing.actions.map((a, j) => j === i ? { ...a, config: { title: e.target.value } } : a) })} />
                    )}
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline"
                  onClick={() => setEditing({ ...editing, actions: [...editing.actions, { type: "add_note", config: { body: "" } }] })}>
                  + action step
                </Button>
              </div>
            </div>

            {(save.isError || !!testResult && false) && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{(save.error as Error)?.message}</p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" disabled={save.isPending}>{save.isPending ? <Spinner /> : null} Save automation</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* test result */}
      <Modal open={!!testResult} onClose={() => setTestResult(null)} title="Dry-run result" wide>
        {testResult && (
          <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-paper-50 p-4 text-xs leading-relaxed text-paper-700">
            {JSON.stringify(testResult, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  );
}
