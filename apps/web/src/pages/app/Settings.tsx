import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiUrl } from "../../lib/api";
import { Badge, Button, Field, PageHeader, SegmentedControl, Select, Spinner, inputCls, cx } from "../../components/ui";
import AutomationsTab from "./settings-tabs/AutomationsTab";
import WebhooksTab from "./settings-tabs/WebhooksTab";

interface Stage { id: string; name: string; kind: string; position: number }
interface Pipeline { id: string; stages: Stage[] }
interface CustomField {
  id: string; target: string; key: string; label: string; type: string;
  options: string[] | null; showInTable: boolean;
}
interface ApiKey { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null }
interface IntakeForm { id: string; name: string; slug: string; publicUrl?: string }
interface WorkspaceInfo { name: string; slug: string; plan: string; aiCreditsBalance: number; members: Array<{ id: string; name: string; email: string; role: string }> }

type Tab = "pipeline" | "fields" | "keys" | "forms" | "automations" | "webhooks" | "integrations" | "audit" | "security";

export default function Settings() {
  const [tabRaw, setTab] = useState<Tab | null>(null);
  const tab: Tab = tabRaw ?? "pipeline";
  const qc = useQueryClient();

  const meQ = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ workspace: WorkspaceInfo; permissions?: string[] }>("/me"),
  });
  const wsQ = { data: meQ.data ? { workspace: meQ.data.workspace } : undefined };
  const perms = new Set(meQ.data?.permissions ?? []);
  const inboundSlug = meQ.data?.workspace.slug;
  const can = (p: string) => perms.has(p);
  const pipelinesQ = useQuery({ queryKey: ["pipelines"], queryFn: () => api.get<Pipeline[]>("/pipelines") });
  const fieldsQ = useQuery({
    queryKey: ["custom-fields"],
    queryFn: () => api.get<CustomField[]>("/custom-fields"),
  });
  const keysQ = useQuery({ queryKey: ["api-keys"], queryFn: () => api.get<ApiKey[]>("/api-keys"), enabled: tab === "keys" });
  const formsQ = useQuery({ queryKey: ["intake-forms"], queryFn: () => api.get<{ items: IntakeForm[] }>("/intake-forms"), enabled: tab === "forms" });

  const [newSecret, setNewSecret] = useState<string | null>(null);

  const addStage = useMutation({
    mutationFn: (name: string) => api.post("/stages", { name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["pipelines"] }),
  });
  const addField = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/custom-fields", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["custom-fields"] }),
  });
  const createKey = useMutation({
    mutationFn: (name: string) => api.post<{ secret: string }>("/api-keys", { name }),
    onSuccess: (data) => setNewSecret(data.secret),
  });
  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const ws = wsQ.data?.workspace;

  return (
    <div className="animate-fade-up mx-auto max-w-4xl pb-10">
      <PageHeader
        title="Settings"
        subtitle={ws ? `${ws.name} · ${ws.plan} plan` : undefined}
        actions={
          ws && (
            <div className="panel flex items-center gap-2 px-4 py-2">
              <span className="text-[11px] uppercase tracking-widest text-paper-600">AI credits</span>
              <span className="num text-[13px] font-medium text-paper-800">{ws.aiCreditsBalance.toLocaleString()}</span>
            </div>
          )
        }
      />

      <div className="mb-5">
        <SegmentedControl
          value={tab}
          onChange={setTab}
          options={([
            { value: "pipeline", label: "Stages" },
            { value: "fields", label: "Fields", show: can("manage_fields") },
            { value: "automations", label: "Automations", show: can("manage_automations") },
            { value: "webhooks", label: "Webhooks", show: can("manage_webhooks") },
            { value: "keys", label: "API keys", show: can("manage_team") || can("manage_billing") },
            { value: "forms", label: "Forms", show: can("manage_pipeline") },
            { value: "integrations", label: "Integrations", show: true },
            { value: "audit", label: "Audit log", show: true },
            { value: "security", label: "Security", show: true },
          ] as Array<{ value: Tab; label: string; show?: boolean }>).filter((o) => o.show !== false)}
        />
      </div>

      {tab === "pipeline" && (
        <section className="panel animate-fade-in p-5">
          <h3 className="mb-1 text-sm font-semibold text-paper-900">Pipeline stages</h3>
          <p className="mb-4 text-xs text-paper-600">Deal flow moves left to right through these.</p>
          <ol className="mb-5 space-y-2">
            {(pipelinesQ.data?.[0]?.stages ?? []).map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 rounded-md border border-paper-900/[0.09] bg-paper-100 px-2.5 py-2 text-[13px]">
                <span className="num w-5 text-xs text-paper-500">{i + 1}</span>
                <span className="font-medium text-paper-900">{s.name}</span>
                <Badge tone={s.kind === "won" ? "green" : s.kind === "lost" ? "red" : "slate"}>{s.kind}</Badge>
              </li>
            ))}
          </ol>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("stage") as HTMLInputElement;
              if (input.value.trim()) addStage.mutate(input.value.trim());
              input.value = "";
            }}
          >
            <input name="stage" placeholder="New stage name…" className={cx(inputCls, "max-w-xs")} />
            <Button type="submit" variant="outline">Add stage</Button>
          </form>
        </section>
      )}

      {tab === "fields" && (
        <section className="panel animate-fade-in p-5">
          <h3 className="mb-1 text-sm font-semibold text-paper-900">Custom fields</h3>
          <p className="mb-4 text-xs text-paper-600">AI fills these automatically from decks and emails.</p>
          <ul className="mb-5 space-y-2">
            {(fieldsQ.data ?? []).map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-paper-900/[0.09] bg-paper-100 px-2.5 py-2 text-[13px]">
                <span className="font-medium text-paper-900">
                  {f.label}
                  <code className="ml-2 rounded-[4px] bg-paper-200/70 px-1 py-0.5 font-mono text-[10px] text-paper-600">{f.key}</code>
                </span>
                <span className="flex items-center gap-1.5">
                  <Badge tone="indigo">{f.target}</Badge>
                  <Badge>{f.type}</Badge>
                  {f.options && <span className="text-[11px] text-paper-500">{f.options.join(" / ")}</span>}
                </span>
              </li>
            ))}
            {!fieldsQ.data?.length && <li className="text-sm text-paper-500">No fields yet.</li>}
          </ul>
          <form
            className="grid grid-cols-2 items-end gap-3 md:grid-cols-[110px_110px_1fr_120px_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const optionsRaw = String(fd.get("options") ?? "");
              void addField.mutateAsync({
                target: fd.get("target"),
                key: String(fd.get("key")).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
                label: fd.get("label"),
                type: fd.get("type"),
                options: optionsRaw ? optionsRaw.split("/").map((s) => s.trim()) : undefined,
              }).then(() => form.reset());
            }}
          >
            <Field label="Applies to"><Select name="target" defaultValue="company"><option value="company">Company</option><option value="deal">Deal</option></Select></Field>
            <Field label="Type">
              <Select name="type" defaultValue="text">
                {["text", "long_text", "number", "currency", "select", "date", "url"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Label"><input name="label" required className={inputCls} /></Field>
            <Field label="Options (/)"><input name="options" className={inputCls} placeholder="A/B/C" /></Field>
            <Button type="submit" disabled={addField.isPending}>Add</Button>
          </form>
        </section>
      )}

      {tab === "keys" && (
        <section className="panel animate-fade-in p-5">
          <h3 className="mb-1 text-sm font-semibold text-paper-900">API keys for agents</h3>
          <p className="mb-4 text-xs text-paper-600">
            Use with the MCP server (<code className="rounded bg-paper-200/70 px-1 font-mono text-[10px]">COPYR_API_KEY</code>) or REST (<code className="rounded bg-paper-200/70 px-1 font-mono text-[10px]">X-API-Key</code>).
          </p>
          {newSecret && (
            <p className="mb-4 break-all rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
              Copy now — shown once: <b className="font-mono">{newSecret}</b>
            </p>
          )}
          <ul className="mb-5 space-y-2">
            {(keysQ.data ?? []).map((k) => (
              <li key={k.id} className="flex items-center justify-between rounded-md border border-paper-900/[0.09] bg-paper-100 px-2.5 py-2 text-[13px]">
                <span className="font-medium text-paper-900">
                  {k.name}
                  <code className="ml-2 font-mono text-[11px] text-paper-600">{k.prefix}…</code>
                </span>
                {k.revokedAt ? (
                  <Badge tone="red">revoked</Badge>
                ) : (
                  <Button size="xs" variant="ghost" onClick={() => revokeKey.mutate(k.id)}>Revoke</Button>
                )}
              </li>
            ))}
            {!keysQ.data?.length && <li className="text-sm text-paper-500">No keys yet.</li>}
          </ul>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("keyName") as HTMLInputElement;
              if (input.value.trim()) createKey.mutate(input.value.trim());
              input.value = "";
            }}
          >
            <input name="keyName" placeholder="e.g. Claude Desktop agent" className={cx(inputCls, "max-w-xs")} />
            <Button type="submit" variant="outline">Create key</Button>
          </form>
        </section>
      )}

      {tab === "automations" && <div className="panel animate-fade-in p-5"><AutomationsTab /></div>}
      {tab === "webhooks" && <div className="panel animate-fade-in p-5"><WebhooksTab /></div>}

      {tab === "integrations" && (
        <section className="panel animate-fade-in space-y-4 p-5">
          <IntegrationCard
            name="REST API — OpenAPI spec"
            desc={
              <>
                Machine-readable contract for all endpoints. Fetch{" "}
                <code className="rounded bg-paper-200/70 px-1 font-mono text-[10px]">/api/v1/openapi.json</code> from any
                agent or codegen tool.
              </>
            }
            cta="View spec"
            onCta={() => window.open(apiUrl("/api/v1/openapi.json"), "_blank")}
          />

          <IntegrationCard
            name="Inbound email address"
            desc={
              <>
                Forward pitch emails here — every message is deduped, its company detected and filed.
                Local dev: send via SMTP <code className="rounded bg-paper-200/70 px-1 font-mono text-[10px]">localhost:1025</code> (Mailpit
                auto-forwards). Production: SES rule → webhook shown below.
              </>
            }
            cta="Copy address"
            onCta={() => navigator.clipboard.writeText(`deals@${inboundSlug}.inbound.venturelabs.vercel.app`)}
          />
          <IntegrationCard
            name="Gmail"
            desc={
              <>
                Read-only sync (<code className="rounded bg-paper-200/70 px-1 font-mono text-[10px]">gmail.readonly</code>) displaying deal-flow
                email in real-time without storing content. VentureLabs adheres to Google's API Services User Data Policy,
                including the Limited Use requirements.
              </>
            }
            cta="Connect"
            onCta={() => alert("Gmail OAuth activates with the Supabase auth milestone.")}
          />
          <IntegrationCard
            name="Zapier / Tally / webhooks"
            desc={
              <>
                Point any form or automation at these endpoints — they create pipeline records.
                Field mapping: <b>Tally/Zapier → intake form</b> (<code>company_name</code>, <code>website</code>,
                <code>one_liner</code>, <code>round</code>, <code>deck_url</code>) · <b>Capture</b> (<code>url</code>,{" "}
                <code>title</code>, optional <code>screenshotBase64</code>) with header <code>X-API-Key</code>.
              </>
            }
            cta="View endpoints"
            onCta={() => setTab("forms")}
          />
          <IntegrationCard
            name="MCP server"
            desc={
              <>
                Give Claude or any MCP client full CRM access: <code>pnpm --filter @copyr/mcp run stdio</code>, or point
                remote agents at the streamable-HTTP endpoint.
              </>
            }
            cta="Copy docs link"
            onCta={() => navigator.clipboard.writeText(`${window.location.origin}/docs/ARCHITECTURE.md`)}
          />
        </section>
      )}

      {tab === "audit" && <AuditLog />}

      {tab === "security" && <SecurityPanel />}

      {tab === "forms" && (
        <section className="panel animate-fade-in p-5">
          <h3 className="mb-4 text-sm font-semibold text-paper-900">Website intake forms</h3>
          <form
            className="mb-4 flex items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const name = (form.elements.namedItem("formName") as HTMLInputElement).value.trim();
              if (!name) return;
              await api.post("/intake-forms", { name });
              void qc.invalidateQueries({ queryKey: ["intake-forms"] });
              form.reset();
            }}
          >
            <input name="formName" placeholder="New form name — e.g. Website pitch form" className={cx(inputCls, "max-w-xs")} />
            <Button type="submit" variant="outline">Create form</Button>
          </form>
          <ul className="space-y-2">
            {(formsQ.data?.items ?? []).map((f) => (
              <li key={f.id} className="rounded-md border border-paper-900/[0.09] bg-paper-100 px-2.5 py-2 text-[13px]">
                <b className="text-paper-900">{f.name}</b>
                <p className="mt-0.5 break-all text-xs text-paper-600">
                  POST to <code className="rounded bg-brand-50 px-1 font-mono text-[10px] text-brand-700 ring-1 ring-inset ring-brand-200">{f.publicUrl ?? `/api/v1/public/forms/${f.slug}`}</code>
                </p>
              </li>
            ))}
            {!formsQ.data?.items.length && <li className="text-sm text-paper-500">No forms yet.</li>}
          </ul>
        </section>
      )}

      {meQ.isLoading && <Spinner className="mx-auto mt-8" />}
    </div>
  );
}


/* ── integrations ─────────────────────────────────────────────────── */

function IntegrationCard({
  name,
  desc,
  cta,
  onCta,
}: {
  name: string;
  desc: React.ReactNode;
  cta: string;
  onCta: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-paper-900/[0.09] bg-paper-100 p-4">
      <div>
        <h3 className="text-sm font-semibold text-paper-900">{name}</h3>
        <p className="mt-1 text-xs leading-relaxed text-paper-600">{desc}</p>
      </div>
      <Button size="xs" variant="outline" onClick={onCta}>{cta}</Button>
    </div>
  );
}

/* ── workspace audit log ──────────────────────────────────────────── */

function AuditLog() {
  const q = useQuery({
    queryKey: ["audit-log"],
    queryFn: () =>
      api.get<{ items: Array<{ id: string; type: string; summary: string; actor: string; createdAt: string }> }>(
        "/activity?limit=200",
      ),
    refetchInterval: 15_000,
  });
  return (
    <section className="panel animate-fade-in p-5">
      <h3 className="mb-1 text-sm font-semibold text-paper-900">Workspace audit log</h3>
      <p className="mb-4 text-xs text-paper-600">Every mutation — human, AI or automation.</p>
      <ul className="divide-y divide-paper-900/[0.07]">
        {(q.data?.items ?? []).map((a) => (
          <li key={a.id} className="flex items-center justify-between py-2 text-[13px]">
            <span className="flex items-center gap-2">
              <span>{a.actor === "ai" ? "🤖" : a.actor === "user" ? "👤" : "⚙️"}</span>
              <span className="text-paper-800">{a.summary}</span>
            </span>
            <span className="shrink-0 text-[11px] text-paper-500">{new Date(a.createdAt).toLocaleString()}</span>
          </li>
        ))}
        {!q.data?.items.length && <li className="py-3 text-sm text-paper-500">No activity yet.</li>}
      </ul>
    </section>
  );
}

/* ── security & notifications ─────────────────────────────────────── */

function SecurityPanel() {
  const qc = useQueryClient();
  const prefsQ = useQuery({
    queryKey: ["notif-prefs"],
    queryFn: () => api.get<Record<string, boolean>>("/me/notification-prefs"),
  });
  const prefs = prefsQ.data ?? {};
  const save = useMutation({
    mutationFn: (next: Record<string, boolean>) => api.put("/me/notification-prefs", next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notif-prefs"] }),
  });
  return (
    <section className="space-y-4">
      <div className="panel animate-fade-in p-5">
        <h3 className="text-sm font-semibold text-paper-900">Notifications</h3>
        <p className="mb-3 mt-0.5 text-xs text-paper-600">Persisted to your member profile.</p>
        {[
          ["deal_created", "New deals created by AI"],
          ["needs_review", "Email needs review"],
          ["mentions", "@mentions in notes"],
          ["workflow_runs", "Automation runs"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 py-1.5 text-[13px] text-paper-800">
            <input
              type="checkbox"
              checked={!!prefs[key]}
              onChange={(e) => save.mutate({ ...prefs, [key]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="panel animate-fade-in p-5">
        <h3 className="text-sm font-semibold text-paper-900">Multi-factor authentication</h3>
        <p className="mb-3 mt-0.5 text-xs text-paper-600">TOTP-based MFA activates with the Supabase auth milestone.</p>
        <Button size="xs" variant="outline" disabled>Enable MFA (soon)</Button>
      </div>
      <div className="panel animate-fade-in p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-paper-900">
          SAML SSO <Badge tone="purple">Enterprise</Badge>
        </h3>
        <p className="mb-3 mt-0.5 text-xs text-paper-600">Okta, Azure AD and Google Workspace SSO for Custom-plan firms.</p>
        <Button size="xs" variant="outline" disabled>Contact sales</Button>
      </div>
    </section>
  );
}
