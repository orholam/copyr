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
    blurb: "Company with no website → Thesis Screener. (With a domain, enrich runs first.)",
    triggerEvent: "company.created",
    conditions: [{ field: "company.domain", op: "nexists" }],
    actions: [{ type: "run_agent", config: { agentName: "Thesis Screener" } }],
  },
  {
    name: "Promote advancing screens",
    blurb: "Thesis Screener says advance → Initial Review. High conviction is set when that field exists.",
    triggerEvent: "agent_run.completed",
    conditions: [
      { field: "agent.name", op: "eq", value: "Thesis Screener" },
      { field: "output.recommendation", op: "eq", value: "advance" },
    ],
    actions: [
      { type: "set_deal_fields", config: { fields: { conviction: "High" } } },
      { type: "move_deal", config: { stageName: "Initial Review" } },
    ],
  },
  {
    name: "File pass recommendations",
    blurb: "Thesis Screener says pass → move to Passed.",
    triggerEvent: "agent_run.completed",
    conditions: [
      { field: "agent.name", op: "eq", value: "Thesis Screener" },
      { field: "output.recommendation", op: "eq", value: "pass" },
    ],
    actions: [{ type: "move_deal", config: { stageName: "Passed" } }],
  },
  {
    name: "Diligence kickoff",
    blurb: "Deal enters Due Diligence → provision the standard checklist.",
    triggerEvent: "deal.stage_changed",
    conditions: [{ field: "deal.stageName", op: "eq", value: "Due Diligence" }],
    actions: [
      { type: "run_agent", config: { agentName: "Diligence Checklist Builder" } },
    ],
  },
];
