/** Shared VC workflow use-case specs (UI + install). */
export const WORKFLOW_USE_CASES: Array<{
  name: string;
  blurb: string;
  triggerEvent: string;
  conditions: Array<{ field: string; op: string; value?: string | number }>;
  actions: Array<{ type: string; config: Record<string, unknown> }>;
}> = [
  {
    name: "Screen new companies",
    blurb: "Inbound company → Thesis Screener (advance / watch / pass).",
    triggerEvent: "company.created",
    conditions: [],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
  },
  {
    name: "Promote advancing screens",
    blurb: "Screen says advance → High conviction, Initial Review, partner note.",
    triggerEvent: "agent_run.completed",
    conditions: [{ field: "output.recommendation", op: "eq", value: "advance" }],
    actions: [
      { type: "set_deal_fields", config: { fields: { conviction: "High" } } },
      { type: "move_deal", config: { stageName: "Initial Review" } },
      {
        type: "add_note",
        config: {
          body: "{{agent.name}} scored {{output.fitScore}}/100 (advance) on {{company.name}} — flagged for partner attention.",
        },
      },
    ],
  },
  {
    name: "File pass recommendations",
    blurb: "Screen says pass → move to Passed with a short rationale note.",
    triggerEvent: "agent_run.completed",
    conditions: [{ field: "output.recommendation", op: "eq", value: "pass" }],
    actions: [
      { type: "move_deal", config: { stageName: "Passed" } },
      {
        type: "add_note",
        config: {
          body: "{{agent.name}} recommended pass on {{company.name}} ({{output.fitScore}}/100). Auto-filed to Passed.",
        },
      },
    ],
  },
  {
    name: "Diligence kickoff",
    blurb: "Deal enters Due Diligence → provision the standard checklist.",
    triggerEvent: "deal.stage_changed",
    conditions: [{ field: "deal.stageName", op: "eq", value: "Due Diligence" }],
    actions: [
      { type: "run_agent", config: { agentName: "Diligence Checklist Builder" } },
      {
        type: "add_note",
        config: { body: "Diligence Checklist Builder spun up the standard checklist for {{company.name}}." },
      },
    ],
  },
];
