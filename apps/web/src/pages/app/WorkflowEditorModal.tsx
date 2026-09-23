/**
 * Shared workflow editor host — used from Automations, Workflows page, Pipeline, Company.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Modal } from "../../components/ui";
import {
  WorkflowBuilder,
  type ActionDraft,
  type WorkflowDraft,
} from "./WorkflowBuilder";

export interface WorkflowRecord {
  id: string;
  name: string;
  description: string | null;
  triggerEvent: string;
  conditions: Array<{ field: string; op: string; value?: unknown }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
  isEnabled: boolean;
  runCount?: number;
  lastRunAt?: string | null;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function actionToDraft(a: WorkflowRecord["actions"][number]): ActionDraft {
  switch (a.type) {
    case "add_note":
      return { id: uid("act"), type: a.type, config: { body: String(a.config.body ?? "") } };
    case "move_deal":
      return { id: uid("act"), type: a.type, config: { stageName: String(a.config.stageName ?? "") } };
    case "run_agent":
      return { id: uid("act"), type: a.type, config: { agentName: String(a.config.agentName ?? "") } };
    case "create_portfolio_update":
      return { id: uid("act"), type: a.type, config: { title: String(a.config.title ?? "") } };
    case "set_deal_fields":
    case "set_company_fields": {
      const fields = (a.config.fields ?? {}) as Record<string, unknown>;
      return {
        id: uid("act"),
        type: a.type,
        config: {
          fieldsText: Object.entries(fields).map(([k, v]) => `${k}=${String(v)}`).join(", "),
        },
      };
    }
    default:
      return { id: uid("act"), type: a.type, config: {} };
  }
}

export function draftFromWorkflow(w: WorkflowRecord): WorkflowDraft {
  return {
    name: w.name,
    description: w.description ?? "",
    triggerEvent: w.triggerEvent,
    conditions: w.conditions.map((c) => ({
      id: uid("cond"),
      field: c.field,
      op: c.op,
      value: c.op === "exists" ? "" : String(c.value ?? ""),
    })),
    actions: w.actions.length
      ? w.actions.map(actionToDraft)
      : [{ id: uid("act"), type: "run_agent", config: { agentName: "Thesis Screener" } }],
  };
}

export function blankDraft(preset?: Partial<WorkflowDraft>): WorkflowDraft {
  return {
    name: preset?.name ?? "",
    description: preset?.description ?? "",
    triggerEvent: preset?.triggerEvent ?? "company.created",
    conditions: preset?.conditions ?? [],
    actions: preset?.actions ?? [
      { id: uid("act"), type: "run_agent", config: { agentName: "Thesis Screener" } },
    ],
  };
}

function draftToBody(draft: WorkflowDraft) {
  return {
    name: draft.name,
    description: draft.description || undefined,
    triggerEvent: draft.triggerEvent,
    conditions: draft.conditions
      .filter((c) => c.field)
      .map((c) => ({
        field: c.field,
        op: c.op,
        value: c.op === "exists" ? undefined : c.value,
      })),
    actions: draft.actions.map((a) => ({
      type: a.type,
      config:
        a.type === "add_note"
          ? { body: String(a.config.body ?? "") }
          : a.type === "move_deal"
            ? { stageName: String(a.config.stageName ?? "") }
            : a.type === "run_agent"
              ? { agentName: String(a.config.agentName ?? "") }
              : a.type === "create_portfolio_update"
                ? { title: String(a.config.title ?? "") }
                : {
                    fields: Object.fromEntries(
                      String(a.config.fieldsText ?? "")
                        .split(",")
                        .filter(Boolean)
                        .map((pair) => {
                          const eq = pair.indexOf("=");
                          return eq < 0
                            ? [pair.trim(), ""]
                            : [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
                        }),
                    ),
                  },
    })),
    isEnabled: true,
  };
}

/** Full-bleed dotted canvas modal — window IS the board. */
export function WorkflowEditorModal({
  initial,
  preset,
  onClose,
}: {
  initial?: WorkflowRecord;
  preset?: Partial<WorkflowDraft>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      initial ? api.patch(`/workflows/${initial.id}`, body) : api.post("/workflows", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automations-overview"] });
      qc.invalidateQueries({ queryKey: ["workflows"] });
      onClose();
    },
  });

  const [draft, setDraft] = useState<WorkflowDraft>(() =>
    initial ? draftFromWorkflow(initial) : blankDraft(preset),
  );

  return (
    <Modal open onClose={onClose} size="canvas" bare title={initial ? initial.name : "New workflow"}>
      <WorkflowBuilder
        draft={draft}
        onChange={setDraft}
        onSave={() => save.mutate(draftToBody(draft))}
        onCancel={onClose}
        saving={save.isPending}
        isEdit={Boolean(initial)}
      />
    </Modal>
  );
}
