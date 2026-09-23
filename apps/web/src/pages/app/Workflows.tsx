/**
 * First-class Workflows surface — full-bleed dotted list + canvas editor.
 * Automations stays the ops hub (agents / runs); this is where you design flows.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Badge, Button, EmptyState, Skeleton, Spinner, cx, timeAgo } from "../../components/ui";
import { IconBot, IconPlus, IconSpark } from "../../components/icons";
import { DOTTED_BG, WorkflowMiniCanvas, prettyEvent } from "./WorkflowBuilder";
import { WORKFLOW_USE_CASES } from "./workflowUseCases";
import { WorkflowEditorModal, type WorkflowRecord } from "./WorkflowEditorModal";

interface Overview {
  workflows: WorkflowRecord[];
  agents: unknown[];
  recentRuns: unknown[];
}

export default function Workflows() {
  const qc = useQueryClient();
  const overviewQ = useQuery({
    queryKey: ["automations-overview"],
    queryFn: () => api.get<Overview>("/automations/overview"),
  });
  const [editor, setEditor] = useState<WorkflowRecord | "new" | null>(null);
  const [presetTrigger, setPresetTrigger] = useState<string | undefined>();

  const existingNames = new Set((overviewQ.data?.workflows ?? []).map((w) => w.name));

  const install = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/workflows", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations-overview"] }),
  });
  const installAll = useMutation({
    mutationFn: async () => {
      for (const u of WORKFLOW_USE_CASES.filter((x) => !existingNames.has(x.name))) {
        await api.post("/workflows", {
          name: u.name,
          description: u.blurb,
          triggerEvent: u.triggerEvent,
          conditions: u.conditions,
          actions: u.actions,
          isEnabled: true,
        });
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations-overview"] }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, isEnabled }: { id: string; isEnabled: boolean }) =>
      api.patch(`/workflows/${id}`, { isEnabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations-overview"] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations-overview"] }),
  });

  const workflows = overviewQ.data?.workflows ?? [];

  return (
    <div className={cx("flex h-full min-h-0 flex-col overflow-hidden", DOTTED_BG)}>
      <header className="flex shrink-0 items-center gap-3 border-b border-paper-900/[0.06] bg-white/70 px-5 py-3 backdrop-blur-md">
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold tracking-tight text-paper-900">Workflows</h1>
          <p className="text-[12px] text-paper-500">
            When → if → then automations that run across pipeline, inbox, and agents.{" "}
            <Link to="/app/automations" className="text-brand-700 hover:underline">
              Agents & runs
            </Link>
          </p>
        </div>
        {WORKFLOW_USE_CASES.some((u) => !existingNames.has(u.name)) && (
          <Button size="sm" variant="outline" disabled={installAll.isPending} onClick={() => installAll.mutate()}>
            {installAll.isPending ? <Spinner /> : "Install use cases"}
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => {
            setPresetTrigger(undefined);
            setEditor("new");
          }}
        >
          <IconPlus width={14} height={14} /> New
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {/* Use cases */}
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {WORKFLOW_USE_CASES.map((u) => {
            const on = existingNames.has(u.name);
            return (
              <div
                key={u.name}
                className="rounded-lg border border-paper-900/[0.08] bg-white/80 px-3 py-2.5 backdrop-blur-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-paper-900">{u.name}</div>
                    <p className="mt-0.5 text-[11px] leading-snug text-paper-500">{u.blurb}</p>
                  </div>
                  {on ? (
                    <Badge tone="green">on</Badge>
                  ) : (
                    <Button
                      size="xs"
                      disabled={install.isPending}
                      onClick={() =>
                        install.mutate({
                          name: u.name,
                          description: u.blurb,
                          triggerEvent: u.triggerEvent,
                          conditions: u.conditions,
                          actions: u.actions,
                          isEnabled: true,
                        })
                      }
                    >
                      Add
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {overviewQ.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !workflows.length ? (
          <EmptyState
            icon={<IconSpark width={20} height={20} />}
            title="No workflows yet"
            hint="Install a use case above, or open a blank canvas."
            action={
              <Button size="sm" onClick={() => setEditor("new")}>
                <IconPlus width={14} height={14} /> Blank canvas
              </Button>
            }
          />
        ) : (
          <div className="mx-auto grid max-w-4xl gap-2.5">
            {workflows.map((w) => (
              <div
                key={w.id}
                className="rounded-lg border border-paper-900/[0.08] bg-white/85 px-4 py-3 backdrop-blur-sm transition hover:border-paper-900/15"
              >
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 text-left" onClick={() => setEditor(w)}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-paper-900">{w.name}</span>
                      <Badge tone={w.isEnabled ? "green" : "slate"}>
                        {w.isEnabled ? "on" : "off"}
                      </Badge>
                    </div>
                    {w.description && (
                      <p className="mt-0.5 text-xs text-paper-500">{w.description}</p>
                    )}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditor(w)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => toggle.mutate({ id: w.id, isEnabled: !w.isEnabled })}
                    >
                      {w.isEnabled ? "Disable" : "Enable"}
                    </Button>
                    <button
                      className="rounded p-1 text-xs text-paper-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => del.mutate(w.id)}
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <WorkflowMiniCanvas
                  triggerEvent={w.triggerEvent}
                  conditionCount={w.conditions.length}
                  actionLabels={w.actions.map((a) => a.type)}
                />
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-paper-400">
                  <IconBot width={11} height={11} />
                  <span className="capitalize">{prettyEvent(w.triggerEvent)}</span>
                  {w.runCount != null && (
                    <span>
                      · {w.runCount} runs
                      {w.lastRunAt && ` · ${timeAgo(w.lastRunAt)}`}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editor && (
        <WorkflowEditorModal
          initial={editor === "new" ? undefined : editor}
          preset={
            editor === "new" && presetTrigger
              ? { triggerEvent: presetTrigger }
              : undefined
          }
          onClose={() => {
            setEditor(null);
            setPresetTrigger(undefined);
          }}
        />
      )}
    </div>
  );
}
