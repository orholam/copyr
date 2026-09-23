import { loadConfig } from "@copyr/config";
import { createDb } from "../index.js";
import { eq, sql } from "drizzle-orm";
import {
  workspaces,
  users,
  memberships,
  pipelines,
  stages,
  companies,
  customFields,
  fieldValues,
  contacts,
  documents,
  emailMessages,
  activities,
  notes,
  extractions,
  creditLedger,
  portfolioUpdates,
  relationships,
  shareLinks,
  intakeForms,
  vaults,
  vaultDocuments,
  reviewTables,
  reviewRows,
  agents,
  agentRuns,
  spaces,
  spaceParticipants,
  tasks,
  memories,
  researchReports,
  conversations,
  messages,
  workflows,
} from "../schema.js";

import { generateKeyBetween } from "fractional-indexing";

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

const SLUG = "harbor-ventures";

async function main() {
  console.log("Seeding …");

  // Idempotent: wipe existing demo workspace.
  const existing = await db.select().from(workspaces).where(eq(workspaces.slug, SLUG));
  if (existing.length > 0) {
    await db.delete(workspaces).where(eq(workspaces.slug, SLUG));
    console.log(`Removed previous ${SLUG} workspace.`);
  }

  const [ws] = await db
    .insert(workspaces)
    .values({ name: "Harbor Ventures", slug: SLUG, plan: "yearly", aiCreditsBalance: 500 })
    .returning();
  const wsId = ws.id;

  const [gp, principal, analyst] = await db
    .insert(users)
    .values([
      { email: "sarah@harbor.vc", name: "Sarah Kim", title: "General Partner" },
      { email: "mike@harbor.vc", name: "Mike Torres", title: "Principal" },
      { email: "alex@harbor.vc", name: "Alex Rivera", title: "Analyst" },
    ])
    .onConflictDoUpdate({
      target: users.email,
      set: { name: sql`excluded.name` },
    })
    .returning();

  await db.insert(memberships).values([
    { workspaceId: wsId, userId: gp.id, role: "owner" },
    { workspaceId: wsId, userId: principal.id, role: "admin" },
    { workspaceId: wsId, userId: analyst.id, role: "member" },
  ]);

  const [pipeline] = await db
    .insert(pipelines)
    .values({ workspaceId: wsId, name: "Deal Flow", isDefault: true })
    .returning();

  const stageRows = await db
    .insert(stages)
    .values([
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Intake", color: "#94a3b8", position: 0 },
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Initial Review", color: "#6366f1", position: 1 },
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Due Diligence", color: "#f59e0b", position: 2 },
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Partner Meeting", color: "#8b5cf6", position: 3 },
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Committed", color: "#10b981", kind: "won", position: 4 },
      { workspaceId: wsId, pipelineId: pipeline.id, name: "Passed", color: "#ef4444", kind: "lost", position: 5 },
    ])
    .returning();
  const stage = Object.fromEntries(stageRows.map((s) => [s.name, s]));

  const fieldDefs = await db
    .insert(customFields)
    .values([
      {
        workspaceId: wsId, target: "company", key: "sector", label: "Sector",
        type: "select", options: ["AI/ML", "Fintech", "Dev Tools", "Health", "Climate", "Consumer", "Defense", "Robotics"], position: 0,
      },
      {
        workspaceId: wsId, target: "company", key: "geography", label: "Geography",
        type: "select", options: ["SF Bay Area", "NYC", "LA", "Austin", "Remote", "Europe", "Other"], position: 1,
      },
      {
        workspaceId: wsId, target: "company", key: "employees", label: "Employees",
        type: "number", position: 2,
      },
      {
        workspaceId: wsId, target: "company", key: "check_size", label: "Check Size",
        type: "currency", position: 0,
      },
      {
        workspaceId: wsId, target: "company", key: "lead_partner", label: "Lead Partner",
        type: "select", options: ["Sarah Kim", "Mike Torres", "Alex Rivera"], position: 1,
      },
      {
        workspaceId: wsId, target: "company", key: "team_quality", label: "Team Quality",
        type: "select", options: ["A", "A-", "B+", "B", "C"], position: 2,
      },
      {
        workspaceId: wsId, target: "company", key: "conviction", label: "Conviction",
        type: "select", options: ["High", "Medium", "Low"], position: 3,
      },
      {
        workspaceId: wsId, target: "company", key: "deck_url", label: "Deck Source",
        type: "url", showInTable: false, aiExtractable: false, position: 4,
      },
    ])
    .returning();
  const field = Object.fromEntries(fieldDefs.map((f) => [f.key, f]));

  const now = Date.now();
  const daysAgo = (n: number) => new Date(now - n * 86_400_000);

  type CompanySeed = {
    name: string; domain: string; sector: string; geo: string; employees: number;
    founded: number; description: string; stageName: string; round: string;
    ask?: string; owner: typeof gp | typeof principal | typeof analyst;
    source: "email" | "upload" | "link" | "manual" | "form";
    ageDays: number; founder: string; founderEmail: string; portfolio?: boolean;
  };

  const companySeeds: CompanySeed[] = [
    { name: "QuantumLeap AI", domain: "quantumleap.ai", sector: "AI/ML", geo: "SF Bay Area", employees: 24, founded: 2023, description: "Foundation-model inference optimization layer cutting GPU spend 60%.", stageName: "Partner Meeting", round: "Series A", ask: "15000000", owner: gp, source: "email", ageDays: 21, founder: "Priya Sharma", founderEmail: "priya@quantumleap.ai" },
    { name: "DataFlow Systems", domain: "dataflow.dev", sector: "Dev Tools", geo: "Remote", employees: 11, founded: 2024, description: "Realtime data pipeline observability for platform teams.", stageName: "Due Diligence", round: "Seed", ask: "5000000", owner: principal, source: "email", ageDays: 14, founder: "Marcus Chen", founderEmail: "marcus@dataflow.dev" },
    { name: "SecureNet Labs", domain: "securenetlabs.io", sector: "Defense", geo: "Austin", employees: 18, founded: 2023, description: "Zero-trust network fabric for critical infrastructure.", stageName: "Due Diligence", round: "Series A", ask: "12000000", owner: gp, source: "link", ageDays: 30, founder: "Dana Okafor", founderEmail: "dana@securenetlabs.io" },
    { name: "CloudScale", domain: "cloudscale.sh", sector: "Dev Tools", geo: "SF Bay Area", employees: 32, founded: 2022, description: "Autoscaling control plane for Kubernetes fleets.", stageName: "Committed", round: "Series B", ask: "25000000", owner: gp, source: "manual", ageDays: 90, founder: "Jonas Weber", founderEmail: "jonas@cloudscale.sh", portfolio: true },
    { name: "BioTech Labs", domain: "biotechlabs.bio", sector: "Health", geo: "Boston", employees: 15, founded: 2023, description: "ML-driven protein design for therapeutics discovery.", stageName: "Passed", round: "Seed", ask: "6000000", owner: analyst, source: "email", ageDays: 60, founder: "Lena Fischer", founderEmail: "lena@biotechlabs.bio" },
    { name: "FinRoute", domain: "finroute.com", sector: "Fintech", geo: "NYC", employees: 9, founded: 2024, description: "Cross-border treasury routing for mid-market CFOs.", stageName: "Initial Review", round: "Pre-seed", ask: "2000000", owner: analyst, source: "email", ageDays: 5, founder: "Tomás Alvarez", founderEmail: "tomas@finroute.com" },
    { name: "GreenGrid Energy", domain: "greengrid.energy", sector: "Climate", geo: "Austin", employees: 21, founded: 2023, description: "Virtual power plant software aggregating distributed batteries.", stageName: "Initial Review", round: "Seed", ask: "4500000", owner: principal, source: "form", ageDays: 3, founder: "Hana Sato", founderEmail: "hana@greengrid.energy" },
    { name: "PixelForge Studios", domain: "pixelforge.gg", sector: "Consumer", geo: "LA", employees: 7, founded: 2024, description: "Generative asset pipeline for indie game studios.", stageName: "Intake", round: "Pre-seed", ask: "1500000", owner: analyst, source: "email", ageDays: 1, founder: "Chris Park", founderEmail: "chris@pixelforge.gg" },
    { name: "MedSync Health", domain: "medsync.health", sector: "Health", geo: "Chicago", employees: 13, founded: 2023, description: "Care-coordination automation between clinics and payers.", stageName: "Intake", round: "Seed", ask: "4000000", owner: analyst, source: "email", ageDays: 1, founder: "Dr. Amara Nwosu", founderEmail: "amara@medsync.health" },
    { name: "Reactiv", domain: "reactiv.io", sector: "AI/ML", geo: "SF Bay Area", employees: 40, founded: 2021, description: "Agentic workflow engine for enterprise operations teams.", stageName: "Committed", round: "Series B", ask: "30000000", owner: gp, source: "email", ageDays: 120, founder: "Ella Nguyen", founderEmail: "ella@reactiv.io", portfolio: true },
    { name: "Orbital Defense Co", domain: "orbitaldefense.co", sector: "Defense", geo: "Denver", employees: 28, founded: 2022, description: "Low-cost satellite situational awareness constellation.", stageName: "Passed", round: "Series A", ask: "18000000", owner: principal, source: "link", ageDays: 45, founder: "Rex Dalton", founderEmail: "rex@orbitaldefense.co" },
    { name: "LoopCart", domain: "loopcart.shop", sector: "Consumer", geo: "NYC", employees: 6, founded: 2024, description: "Reusable-packaging logistics network for e-commerce brands.", stageName: "Intake", round: "Pre-seed", ask: "1250000", owner: analyst, source: "form", ageDays: 2, founder: "Maya Goldstein", founderEmail: "maya@loopcart.shop" },
  ];

  const stageLastPos = new Map<string, string | null>();
  const companyBySeed = new Map<string, { id: string; dealId: string; stageName: string }>();

  for (const cs of companySeeds) {
    const [company] = await db
      .insert(companies)
      .values({
        workspaceId: wsId,
        name: cs.name,
        domain: cs.domain,
        sector: cs.sector,
        location: cs.geo,
        description: cs.description,
        foundedYear: cs.founded,
        employeeCount: cs.employees,
        status: cs.portfolio ? "portfolio" : "active",
        source: cs.source,
        createdByUserId: cs.source === "manual" ? gp.id : null,
        createdAt: daysAgo(cs.ageDays),
        updatedAt: daysAgo(cs.ageDays),
        pipelineId: pipeline.id,
        stageId: stage[cs.stageName]!.id,
        ownerUserId: cs.owner.id,
        roundStage: cs.round,
        askAmount: cs.ask ?? null,
        position: (() => {
          const last = stageLastPos.get(cs.stageName) ?? null;
          const next = generateKeyBetween(last, null);
          stageLastPos.set(cs.stageName, next);
          return next;
        })(),
        sourceRef: cs.source === "email" ? `msg_${cs.domain}` : null,
      })
      .returning();

    const deal = company;

    await db.insert(fieldValues).values([
      { workspaceId: wsId, fieldId: field.sector!.id, entityType: "company", entityId: company.id, value: JSON.stringify(cs.sector), setByActor: "ai", confidence: "0.95" },
      { workspaceId: wsId, fieldId: field.geography!.id, entityType: "company", entityId: company.id, value: JSON.stringify(cs.geo), setByActor: "user" },
      { workspaceId: wsId, fieldId: field.employees!.id, entityType: "company", entityId: company.id, value: JSON.stringify(cs.employees), setByActor: "ai", confidence: "0.85" },
      { workspaceId: wsId, fieldId: field.lead_partner!.id, entityType: "company", entityId: company.id, value: JSON.stringify(cs.owner.name), setByActor: "user" },
    ]);

    await db.insert(contacts).values({
      workspaceId: wsId,
      companyId: company.id,
      name: cs.founder,
      email: cs.founderEmail,
      title: "Founder & CEO",
      isFounder: true,
    });

    await db.insert(activities).values({
      workspaceId: wsId,
      entityType: "deal",
      entityId: deal.id,
      companyId: company.id,
      dealId: deal.id,
      type: "deal.created",
      actor: cs.source === "email" ? "system" : "user",
      actorUserId: cs.source === "email" ? null : cs.owner.id,
      summary: `Deal created from ${cs.source}`,
      data: { source: cs.source, stage: cs.stageName },
      createdAt: daysAgo(cs.ageDays),
    });

    companyBySeed.set(cs.name, { id: company.id, dealId: deal.id, stageName: cs.stageName });
  }

  // Documents (decks) for a few companies — text pre-parsed to simulate pipeline output.
  const deckTargets = ["QuantumLeap AI", "DataFlow Systems", "Reactiv", "FinRoute"];
  for (const name of deckTargets) {
    const c = companyBySeed.get(name)!;
    const cs = companySeeds.find((x) => x.name === name)!;
    await db.insert(documents).values({
      workspaceId: wsId,
      companyId: c.id,
      dealId: c.dealId,
      name: `${name} — ${cs.round} Deck.pdf`,
      mime: "application/pdf",
      sizeBytes: 2_400_000 + Math.floor(Math.random() * 4_000_000),
      storageKey: `workspaces/${wsId}/documents/seed-${c.id}.pdf`,
      pageCount: 18,
      source: cs.source === "link" ? "link_conversion" : cs.source === "email" ? "email_attachment" : "upload",
      sourceUrl: cs.source === "link" ? `https://docsend.com/view/${c.id.slice(0, 8)}` : null,
      parseStatus: "parsed",
      textContent: `${name}\n${cs.description}\nRound: ${cs.round}. Ask: $${(Number(cs.ask ?? 0) / 1e6).toFixed(1)}M.\nSector: ${cs.sector}. Team of ${cs.employees}, founded ${cs.founded}, based in ${cs.geo}. Founded by ${cs.founder}.`,
      createdAt: daysAgo(cs.ageDays),
    });
  }

  // Processed inbound emails
  const emailSeeds = [
    {
      subject: "Pitch Deck — QuantumLeap AI Series A",
      fromEmail: "priya@quantumleap.ai",
      fromName: "Priya Sharma",
      body: "Hi Sarah, attached is our Series A deck. We are raising $15M led off a $4.2M ARR growing 180% YoY. Would love 30 minutes.",
      company: "QuantumLeap AI",
      ageHours: 2,
    },
    {
      subject: "Introduction to FinRoute",
      fromEmail: "marcus@dataflow.dev",
      fromName: "Marcus Chen",
      body: "Wanted to intro you to FinRoute — cross-border treasury for mid-market CFOs, live with 40 customers.",
      company: "FinRoute",
      ageHours: 26,
    },
    {
      subject: "Update: Reactiv Q2 investor update",
      fromEmail: "ella@reactiv.io",
      fromName: "Ella Nguyen",
      body: "Q2: ARR reached $5M milestone, hired new CTO from Google, NRR at 128%.",
      company: "Reactiv",
      ageHours: 50,
    },
  ];

  for (const es of emailSeeds) {
    const c = companyBySeed.get(es.company)!;
    const receivedAt = new Date(now - es.ageHours * 3_600_000);
    const [email] = await db
      .insert(emailMessages)
      .values({
        workspaceId: wsId,
        messageId: `seed-${es.fromEmail}-${es.ageHours}@mailpit.local`,
        direction: "inbound",
        channel: "forward",
        fromEmail: es.fromEmail,
        fromName: es.fromName,
        toEmails: ["deals@harbor.vc"],
        subject: es.subject,
        bodyText: es.body,
        attachments: [],
        receivedAt,
        processingStatus: "processed",
        processedResult: {
          matchedCompanies: [es.company],
          summary: `Inbound about ${es.company}`,
          confidence: 0.92,
        },
        createdAt: receivedAt,
      })
      .returning();

    await db.insert(relationships).values({
      workspaceId: wsId,
      companyId: c.id,
      contactEmail: es.fromEmail,
      teamMemberUserId: gp.id,
      teamMemberEmail: gp.email,
      interactionCount: 3,
      lastInteractionAt: receivedAt,
    });

    await db.insert(portfolioUpdates).values({
      workspaceId: wsId,
      companyId: c.id,
      title: es.subject.replace(/^Update:\s*/, ""),
      body: es.body,
      kind: es.company === "Reactiv" ? "milestone" : "update",
      occurredAt: receivedAt,
      source: "email",
      sourceEmailId: email.id,
    });
  }

  // Notes
  const ql = companyBySeed.get("QuantumLeap AI")!;
  const dfs = companyBySeed.get("DataFlow Systems")!;
  await db.insert(notes).values([
    { workspaceId: wsId, authorUserId: gp.id, companyId: ql.id, dealId: ql.dealId, body: "Strongest inference-efficiency team we've seen. Priya ex-DeepMind. Partner meeting Thu.", pinned: true },
    { workspaceId: wsId, authorUserId: principal.id, companyId: ql.id, dealId: ql.dealId, body: "Need reference calls with 2 design partners before term sheet." },
    { workspaceId: wsId, authorUserId: analyst.id, companyId: dfs.id, dealId: dfs.dealId, body: "Competitive: Monte Carlo, Cribl adjacent. Differentiator is realtime tracing." },
  ]);

  // An extraction record + credits history
  await db.insert(extractions).values([
    { workspaceId: wsId, kind: "deck", status: "completed", documentId: null, companyId: ql.id, dealId: ql.dealId, model: "mock", result: { sector: "AI/ML", ask_amount: 15000000 }, confidence: "0.93", creditsUsed: 2, completedAt: daysAgo(20) },
    { workspaceId: wsId, kind: "email", status: "completed", emailId: null, companyId: ql.id, model: "mock", result: { intent: "fundraise", round: "Series A" }, confidence: "0.9", creditsUsed: 1, completedAt: daysAgo(21) },
  ]);
  await db.insert(creditLedger).values([
    { workspaceId: wsId, delta: 500, reason: "monthly_grant", balanceAfter: 500, createdAt: daysAgo(30) },
    { workspaceId: wsId, delta: -2, reason: "deck_extraction", refType: "extraction", balanceAfter: 498, createdAt: daysAgo(20) },
    { workspaceId: wsId, delta: -1, reason: "email_triage", refType: "extraction", balanceAfter: 497, createdAt: daysAgo(21) },
  ]);

  // Share link example
  await db.insert(shareLinks).values({
    workspaceId: wsId,
    token: "ql-demo-share",
    companyId: ql.id,
    title: "QuantumLeap AI — Series A (shared deck)",
    attributes: ["sector", "location", "description"],
    includeDocuments: true,
    viewCount: 12,
    lastViewedAt: daysAgo(1),
    createdByUserId: gp.id,
  });

  // Intake form
  await db.insert(intakeForms).values({
    workspaceId: wsId,
    name: "Harbor Pitch Form",
    slug: "harbor-pitch",
    landingStageId: stage["Intake"]!.id,
    fields: [
      { key: "company_name", label: "Company name", required: true, type: "text" },
      { key: "website", label: "Website", required: true, type: "url" },
      { key: "one_liner", label: "One-liner", required: true, type: "text" },
      { key: "round", label: "Round", required: false, type: "text" },
      { key: "deck_url", label: "Deck link (DocSend/Pitch)", required: false, type: "url" },
    ],
  });

  // ── Platform surfaces: vaults, agents, spaces, memory, research ────

  // Diligence vault on QuantumLeap with parsed docs + a completed review table
  const qlDocs = await db
    .insert(documents)
    .values([
      {
        workspaceId: wsId, companyId: ql.id, dealId: ql.dealId,
        name: "QuantumLeap — Design Partner MSA (Helix Bio)", parseStatus: "parsed",
        textContent:
          "Master services agreement between QuantumLeap AI and Helix Bio. Annual contract value: $240,000.\nInitial term of 24 months with automatic renewal for successive one-year periods unless either party gives notice.\nThe agreement contains a change-of-control provision requiring counterparty consent upon acquisition.",
        pageCount: 12, storageKey: "seed/msa-helix.pdf",
      },
      {
        workspaceId: wsId, companyId: ql.id, dealId: ql.dealId,
        name: "QuantumLeap — Pilot Agreement (Northwind Logistics)", parseStatus: "parsed",
        textContent:
          "Pilot agreement between QuantumLeap AI and Northwind Logistics. Pilot fee: $45,000 for a 6 month engagement.\nNo change-of-control restrictions. Either party may terminate for convenience on 30 days notice.\nIP assignments: all derivative work product vests in QuantumLeap AI upon payment.",
        pageCount: 8, storageKey: "seed/pilot-northwind.pdf",
      },
    ])
    .returning();

  const [qlVault] = await db
    .insert(vaults)
    .values({
      workspaceId: wsId,
      name: "QuantumLeap AI — Data Room",
      description: "Commercial contracts collected ahead of partner meeting.",
      companyId: ql.id,
      dealId: ql.dealId,
      createdByUserId: gp.id,
    })
    .returning();
  await db.insert(vaultDocuments).values(
    qlDocs.map((d) => ({ vaultId: qlVault.id, documentId: d.id })),
  );

  const [reviewTable] = await db
    .insert(reviewTables)
    .values({
      workspaceId: wsId,
      vaultId: qlVault.id,
      name: "Customer contract terms",
      instruction: "Extract commercial terms relevant to Series A diligence.",
      columns: [
        { key: "counterparty", label: "Counterparty", type: "text" },
        { key: "value_usd", label: "Contract value", type: "currency" },
        { key: "term_months", label: "Term", type: "text" },
        { key: "change_of_control", label: "Change-of-control clause", type: "boolean" },
      ],
      status: "completed",
      creditsUsed: 6,
      createdByUserId: gp.id,
      createdAt: daysAgo(2),
      completedAt: daysAgo(2),
    })
    .returning();
  await db.insert(reviewRows).values([
    {
      reviewTableId: reviewTable.id, workspaceId: wsId, documentId: qlDocs[0]!.id, rowIndex: 0,
      data: { counterparty: "Helix Bio", value_usd: 240000, term_months: "24 months + auto-renew", change_of_control: true },
      citations: [
        { quote: "Annual contract value: $240,000." },
        { quote: "contains a change-of-control provision requiring counterparty consent" },
      ],
      confidence: "0.82",
    },
    {
      reviewTableId: reviewTable.id, workspaceId: wsId, documentId: qlDocs[1]!.id, rowIndex: 1,
      data: { counterparty: "Northwind Logistics", value_usd: 45000, term_months: "6 months pilot", change_of_control: null },
      citations: [{ quote: "Pilot fee: $45,000 for a 6 month engagement." }],
      confidence: "0.66",
    },
  ]);

  // Codified fund agents
  const agentRows = await db
    .insert(agents)
    .values([
      {
        workspaceId: wsId, name: "Thesis Screener", kind: "thesis_screen",
        description: "Scores inbound companies against the Harbor thesis and recommends advance / watch / pass.",
        instructions:
          "Harbor backs inference-efficiency and devtools companies at Seed/Series A in North America. Weight team pedigree, design-partner traction, and defensible efficiency gains.",
        config: {
          mustHaveKeywords: ["inference", "efficiency", "developer", "ai"],
          excludeKeywords: ["crypto", "hardware-first"],
        },
        isSystem: true, runCount: 3, lastRunAt: daysAgo(1), createdByUserId: gp.id,
      },
      {
        workspaceId: wsId, name: "Diligence Checklist Builder", kind: "diligence_checklist",
        description: "Provisions the standard Harbor diligence checklist into a deal space.",
        config: {
          checklist: [
            "Customer reference calls — at least two current customers",
            "Technical architecture deep-dive with founding engineers",
            "Cap table review and option-pool check",
            "Competitive landscape map of direct and adjacent players",
            "Cohort retention analysis request to founders",
            "Employment agreements and IP assignment verification",
          ],
        },
        isSystem: true, createdByUserId: gp.id,
      },
      {
        workspaceId: wsId, name: "Portfolio Monitor", kind: "portfolio_monitor",
        description: "Weekly sweep of portfolio events; flags quiet companies.",
        config: { watchItems: ["funding", "hiring", "metric milestones"] },
        scheduleCron: "0 9 * * 1", nextRunAt: new Date(Date.now() + 3 * 24 * 3600 * 1000),
        isSystem: true, runCount: 2, lastRunAt: daysAgo(7), createdByUserId: gp.id,
      },
    ])
    .returning();

  const [thesisRun] = await db
    .insert(agentRuns)
    .values({
      workspaceId: wsId, agentId: agentRows[0]!.id, status: "completed", trigger: "manual",
      companyId: ql.id, dealId: ql.dealId,
      input: { companyId: ql.id },
      output: {
        fitScore: 78,
        recommendation: "advance",
        reasons: [
          "Matches required theme \"inference\".",
          "Matches required theme \"efficiency\".",
          "Revenue metrics available for verification.",
        ],
        concerns: ["Churn mentioned — probe retention drivers."],
        summary: "Fit 78/100 against \"Thesis Screener\" — advance. Strengths: 3 signal(s). Flags: 1.",
        confidence: 0.72,
      },
      steps: [
        { step: "queued", status: "ok", at: daysAgo(1)!.toISOString() },
        { step: "started", status: "ok", at: daysAgo(1)!.toISOString() },
        { step: "score_thesis", status: "running", at: daysAgo(1)!.toISOString() },
        { step: "scored", status: "ok", detail: "fit 78 → advance", at: daysAgo(1)!.toISOString() },
        { step: "screening_note_written", status: "ok", at: daysAgo(1)!.toISOString() },
        { step: "completed", status: "ok", at: daysAgo(1)!.toISOString() },
      ],
      creditsUsed: 5, startedAt: daysAgo(1), completedAt: daysAgo(1), createdAt: daysAgo(1),
    })
    .returning();

  // Deal space with tasks routed between people and an agent
  const [qlSpace] = await db
    .insert(spaces)
    .values({
      workspaceId: wsId,
      name: "Diligence — QuantumLeap AI",
      summary: "Series A evaluation. Vault attached; screening done, references outstanding.",
      companyId: ql.id,
      dealId: ql.dealId,
      vaultId: qlVault.id,
      createdByUserId: gp.id,
    })
    .returning();
  await db.insert(spaceParticipants).values({
    spaceId: qlSpace.id,
    email: "priya@quantumleap.ai",
    name: "Priya Nair",
    org: "QuantumLeap AI",
    role: "viewer",
    invitedByUserId: gp.id,
  });
  await db.insert(tasks).values([
    {
      workspaceId: wsId, spaceId: qlSpace.id, companyId: ql.id, dealId: ql.dealId,
      title: "Founder deep-dive — product + vision", status: "done",
      assigneeUserId: principal.id, position: "a0", completedAt: daysAgo(3), createdByUserId: gp.id,
    },
    {
      workspaceId: wsId, spaceId: qlSpace.id, companyId: ql.id, dealId: ql.dealId,
      title: "Customer references — two current customers", status: "in_progress",
      assigneeUserId: analyst.id, priority: 1, dueAt: new Date(Date.now() + 4 * 24 * 3600 * 1000),
      position: "a1", createdByUserId: gp.id,
    },
    {
      workspaceId: wsId, spaceId: qlSpace.id, companyId: ql.id, dealId: ql.dealId,
      title: "Market map — direct and adjacent competitors", status: "open",
      assigneeAgentId: agentRows[0]!.id, position: "a2", createdByUserId: gp.id,
    },
    {
      workspaceId: wsId, spaceId: qlSpace.id, companyId: ql.id, dealId: ql.dealId,
      title: "Data room review — contracts, IP, employment", status: "done",
      assigneeAgentId: agentRows[1]!.id, position: "a3", completedAt: daysAgo(2), createdByUserId: gp.id,
    },
  ]);
  void thesisRun;

  // Fund memory
  await db.insert(memories).values([
    {
      workspaceId: wsId, userId: null, kind: "focus_area", source: "declared", weight: 5, pinned: true,
      content: "Harbor leads Seed and Series A in inference-efficiency, devtools, and data infrastructure. North America only.",
      createdByUserId: gp.id,
    },
    {
      workspaceId: wsId, userId: gp.id, kind: "preference", source: "declared", weight: 3,
      content: "Sarah wants every IC memo to lead with retention evidence, never top-line growth alone.",
      createdByUserId: gp.id,
    },
    {
      workspaceId: wsId, userId: null, kind: "process", source: "learned", weight: 2,
      content: "Reference calls are logged as notes tagged 'reference' before any partner meeting is scheduled.",
      createdByUserId: principal.id,
    },
  ]);

  // A persisted grounded research report
  await db.insert(researchReports).values({
    workspaceId: wsId,
    question: "What do customer contracts say about change of control?",
    answer:
      "The Helix Bio MSA contains a change-of-control provision requiring counterparty consent upon acquisition, while the Northwind pilot has no such restriction but terminates on 30 days notice. [1] [2]\n\nSources: [1] QuantumLeap — Design Partner MSA (Helix Bio), [2] QuantumLeap — Pilot Agreement (Northwind Logistics)",
    citations: [
      { sourceType: "document", sourceId: qlDocs[0]!.id, sourceName: "Design Partner MSA (Helix Bio)", quote: "contains a change-of-control provision requiring counterparty consent upon acquisition." },
      { sourceType: "document", sourceId: qlDocs[1]!.id, sourceName: "Pilot Agreement (Northwind Logistics)", quote: "Either party may terminate for convenience on 30 days notice." },
    ],
    scopeCompanyId: ql.id,
    scopeVaultId: qlVault.id,
    model: "mock", confidence: "0.74", creditsUsed: 4,
    createdByUserId: gp.id, createdAt: daysAgo(1),
  });

  // Central assistant demo thread
  const [demoConv] = await db
    .insert(conversations)
    .values({
      workspaceId: wsId,
      userId: gp.id,
      title: "Which deals need attention?",
      createdByUserId: gp.id,
    })
    .returning();
  await db.insert(messages).values([
    {
      workspaceId: wsId, conversationId: demoConv.id, role: "user", position: 0,
      content: "Which deals need attention?",
    },
    {
      workspaceId: wsId, conversationId: demoConv.id, role: "assistant", position: 1,
      content: "", data: { toolCalls: [{ name: "analytics_overview", args: {} }, { name: "list_deals", args: { sort: "updated_at", order: "asc" } }] },
    },
    {
      workspaceId: wsId, conversationId: demoConv.id, role: "tool", position: 2,
      content: JSON.stringify({ activeDeals: 9, pipelineUsd: 48200000 }),
      data: { name: "analytics_overview", ok: true },
    },
    {
      workspaceId: wsId, conversationId: demoConv.id, role: "tool", position: 3,
      content: JSON.stringify([
        { dealId: ql.dealId, companyName: "QuantumLeap AI", roundStage: "Series A", askAmount: 15000000, updatedAt: daysAgo(6)!.toISOString() },
      ]),
      data: { name: "list_deals", ok: true },
    },
    {
      workspaceId: wsId, conversationId: demoConv.id, role: "assistant", position: 4,
      content:
        "- Pipeline: 9 active deal(s), $48.2M in play\n- Deal: QuantumLeap AI (Series A) — $15,000,000 — quiet for 6 days; reference calls are still open on the diligence space.",
      data: null,
    },
  ]);

  // ── unified automations: event → agent → action chains ─────────────
  await db.insert(workflows).values([
    {
      workspaceId: wsId,
      name: "Promote advancing screens",
      description:
        "When Thesis Screener says advance, stamp High conviction, move to Initial Review, and brief the team.",
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
      isEnabled: true,
      createdByUserId: gp.id,
    },
    {
      workspaceId: wsId,
      name: "File pass recommendations",
      description: "When Thesis Screener says pass, move the deal to Passed and leave a short rationale note.",
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
      isEnabled: true,
      createdByUserId: gp.id,
    },
    {
      workspaceId: wsId,
      name: "Diligence kickoff",
      description: "When a deal enters Due Diligence, provision the standard checklist so nothing is missed.",
      triggerEvent: "deal.stage_changed",
      conditions: [{ field: "deal.stageName", op: "eq", value: "Due Diligence" }],
      actions: [
        { type: "run_agent", config: { agentName: "Diligence Checklist Builder" } },
        {
          type: "add_note",
          config: { body: "Diligence Checklist Builder spun up the standard checklist for {{company.name}}." },
        },
      ],
      isEnabled: true,
      createdByUserId: gp.id,
    },
    {
      workspaceId: wsId,
      name: "Flag large asks",
      description: "Adds a priority note when an inbound deal asks for more than $5M.",
      triggerEvent: "deal.created" as never,
      conditions: [{ field: "deal.askAmount", op: "gte", value: 5_000_000 }],
      actions: [
        {
          type: "add_note" as never,
          config: { body: "Large ask detected on {{deal.company.name}} — prioritize first review." },
        },
      ],
      isEnabled: true,
      createdByUserId: gp.id,
    },
  ]);

  console.log(`Seeded workspace "${ws.name}" (${wsId}) with ${companySeeds.length} companies/deals.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
