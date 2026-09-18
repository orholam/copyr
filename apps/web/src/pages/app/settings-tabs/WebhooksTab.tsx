import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { Badge, Button, Field as F, Spinner, cx, inputCls } from "../../../components/ui";

interface Subscription {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  isActive: boolean;
  failureCount: number;
  lastDeliveryAt: string | null;
  lastStatus: number | null;
  createdAt: string;
  secret?: string;
}

interface Delivery {
  id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  responseStatus: number | null;
  attempts: number;
  error: string | null;
  createdAt: string;
}

const EVENT_CHOICES = [
  ["*", "All events"],
  ["deal.created", "Deal created"],
  ["deal.stage_changed", "Deal stage changed"],
  ["company.created", "Company created"],
  ["email.processed", "Email processed"],
  ["document.parsed", "Document parsed"],
] as const;

export default function WebhooksTab() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const subsQ = useQuery({ queryKey: ["webhook-subs"], queryFn: () => api.get<Subscription[]>("/webhooks") });
  const selected = subsQ.data?.find((s) => s.id === selectedId) ?? subsQ.data?.[0];

  const deliveriesQ = useQuery({
    queryKey: ["webhook-deliveries", selected?.id],
    queryFn: () => api.get<Delivery[]>(`/webhooks/${selected!.id}/deliveries`),
    enabled: !!selected,
    refetchInterval: 5_000,
  });

  const create = useMutation({
    mutationFn: (payload: { url: string; events: string[]; description?: string }) =>
      api.post<Subscription>("/webhooks", payload),
    onSuccess: (sub) => {
      setNewSecret(sub.secret ?? null);
      void qc.invalidateQueries({ queryKey: ["webhook-subs"] });
    },
  });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/webhooks/${id}`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["webhook-subs"] }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/webhooks/${id}`),
    onSuccess: () => {
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ["webhook-subs"] });
    },
  });

  return (
    <div className="grid grid-cols-[1fr_380px] items-start gap-4">
      {/* subscriptions */}
      <div className="space-y-3">
        {(subsQ.data ?? []).map((sub) => (
          <button
            key={sub.id}
            onClick={() => setSelectedId(sub.id)}
            className={cx(
              "block w-full rounded-xl border p-4 text-left transition",
              selected?.id === sub.id ? "border-brand-400 bg-brand-50/40" : "border-paper-900/[0.12] bg-white hover:border-paper-400",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-paper-800">{sub.url}</span>
              <Badge tone={sub.isActive ? (sub.failureCount > 2 ? "amber" : "green") : "slate"}>
                {sub.isActive ? (sub.failureCount > 2 ? `failing ×${sub.failureCount}` : "healthy") : "paused"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-paper-500">
              Events: {sub.events.join(", ")}
              {sub.lastDeliveryAt && <> · last delivery {new Date(sub.lastDeliveryAt).toLocaleString()} → {sub.lastStatus ?? "?"}</>}
            </p>
          </button>
        ))}
        {!subsQ.data?.length && (
          <div className="rounded-xl border border-dashed border-paper-400 py-12 text-center text-sm text-paper-500">
            No webhook endpoints yet. Create one and Copyr will POST every matching event to it —
            signed with HMAC-SHA256 and retried automatically.
          </div>
        )}

        {newSecret && (
          <p className="break-all rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Signing secret (shown once): <b>{newSecret}</b>
          </p>
        )}

        <form
          className="rounded-xl border border-paper-900/[0.12] bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const fd = new FormData(form);
            const events = fd.getAll("events") as string[];
            create.mutate({
              url: String(fd.get("url")),
              events: events.length ? events : ["*"],
              description: String(fd.get("description") || "") || undefined,
            });
            form.reset();
          }}
        >
          <F label="Endpoint URL">
            <input name="url" required type="url" placeholder="https://yourapp.com/hooks/copyr" className={inputCls} />
          </F>
          <F label="Description">
            <input name="description" placeholder="What is this for?" className={inputCls + " mt-2"} />
          </F>
          <fieldset className="mt-2">
            <legend className="mb-1 block text-xs font-medium text-paper-600">Events</legend>
            <div className="flex flex-wrap gap-3">
              {EVENT_CHOICES.map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5 text-xs text-paper-700">
                  <input type="checkbox" name="events" value={v} defaultChecked={v === "*"} /> {l}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" size="sm" className="mt-3" disabled={create.isPending}>
            {create.isPending ? <Spinner /> : null} Add endpoint
          </Button>
        </form>
      </div>

      {/* delivery log */}
      <div className="rounded-xl border border-paper-900/[0.12] bg-white">
        <div className="flex items-center justify-between border-b border-paper-900/[0.07] px-4 py-3">
          <h3 className="text-sm font-semibold text-paper-700">Deliveries</h3>
          {selected && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ id: selected.id, isActive: !selected.isActive })}>
                {selected.isActive ? "Pause" : "Enable"}
              </Button>
              <Button size="sm" variant="ghost" className="text-red-500" onClick={() => remove.mutate(selected.id)}>Delete</Button>
            </div>
          )}
        </div>
        <ul className="divide-y divide-paper-900/[0.07]">
          {(deliveriesQ.data ?? []).map((d) => (
            <li key={d.id} className="px-4 py-2.5 text-xs">
              <div className="flex items-center justify-between">
                <Badge tone={d.status === "delivered" ? "green" : d.status === "failed" ? "red" : "amber"}>{d.status}</Badge>
                <span className="text-paper-400">{new Date(d.createdAt).toLocaleTimeString()}</span>
              </div>
              <p className="mt-1 font-medium text-paper-700">{d.event}</p>
              <p className="text-paper-400">
                {d.responseStatus ? `HTTP ${d.responseStatus}` : "no response"} · attempt {d.attempts}
                {d.error && <span className="text-red-500"> · {d.error}</span>}
              </p>
            </li>
          ))}
          {!deliveriesQ.data?.length && (
            <li className="px-4 py-6 text-center text-xs text-paper-400">
              {selected ? "No deliveries yet." : "Select an endpoint."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
