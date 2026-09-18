import { describe, it, expect } from "vitest";
import {
  coerceFieldValue,
  mapActivity,
  mapCompany,
  mapCustomField,
  mapDeal,
  mapDocument,
  mapEmail,
  mapNote,
  mapPipeline,
  mapStage,
  toIso,
  type ActivityRow,
  type CompanyRow,
  type CustomFieldRow,
  type DocumentRow,
  type EmailRow,
  type NoteRow,
  type PipelineRow,
  type StageRow,
} from "./mappers.js";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const LATER = new Date("2026-08-02T12:00:00.000Z");

describe("toIso", () => {
  it("converts dates to ISO strings and nulls stay null", () => {
    expect(toIso(NOW)).toBe("2026-08-01T12:00:00.000Z");
    expect(toIso(null)).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });
});

describe("coerceFieldValue", () => {
  it("passes primitives through untouched", () => {
    expect(coerceFieldValue(null)).toBeNull();
    expect(coerceFieldValue(undefined)).toBeNull();
    expect(coerceFieldValue("seed")).toBe("seed");
    expect(coerceFieldValue(42)).toBe(42);
    expect(coerceFieldValue(true)).toBe(true);
  });

  it("keeps all-string arrays as lists", () => {
    expect(coerceFieldValue(["AI", "Fintech"])).toEqual(["AI", "Fintech"]);
  });

  it("stringifies mixed arrays and objects for transport", () => {
    expect(coerceFieldValue([1, "a"])).toBe("[1,\"a\"]");
    expect(coerceFieldValue({ nested: true })).toBe("{\"nested\":true}");
  });
});

const companyRow = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Acme Inc",
  domain: "acme.com",
  sector: "AI/ML",
  location: "San Francisco",
  description: "Rocket ships",
  linkedinUrl: "https://linkedin.com/company/acme",
  logoUrl: "https://cdn/acme.png",
  foundedYear: 2020,
  employeeCount: 24,
  tags: ["ai", "series-a"],
  status: "active",
  source: "manual",
  pipelineId: "33333333-3333-3333-3333-333333333333",
  stageId: "44444444-4444-4444-4444-444444444444",
  ownerUserId: null,
  roundStage: "Series A",
  askAmount: "15000000.00",
  valuation: null,
  priority: 2,
  position: "a0",
  nextStepAt: LATER,
  archivedAt: null,
  sourceRef: "msg-1",
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as CompanyRow;

describe("mapCompany", () => {
  it("maps core columns and defaults null tags to an empty array", () => {
    const dto = mapCompany({ ...companyRow, tags: null } as unknown as CompanyRow);
    expect(dto).toMatchObject({
      id: companyRow.id,
      name: "Acme Inc",
      domain: "acme.com",
      status: "active",
      source: "manual",
      tags: [],
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
    });
    expect(dto.fields).toEqual({});
  });

  it("coerces custom field values into transport-safe primitives", () => {
    const dto = mapCompany(companyRow, {
      arr: 4_200_000,
      focus: ["US", "EU"],
      extra: { a: 1 },
    });
    expect(dto.fields["arr"]).toBe(4_200_000);
    expect(dto.fields["focus"]).toEqual(["US", "EU"]);
    expect(dto.fields["extra"]).toBe("{\"a\":1}");
  });
});

describe("mapDeal", () => {
  it("converts numeric strings to numbers and keeps nulls", () => {
    const dto = mapDeal(companyRow);
    expect(dto.askAmount).toBe(15_000_000);
    expect(dto.valuation).toBeNull();
    expect(dto.nextStepAt).toBe("2026-08-02T12:00:00.000Z");
    expect(dto.archivedAt).toBeNull();
    expect(dto.id).toBe(companyRow.id);
    expect(dto.companyId).toBe(companyRow.id);
  });

  it("embeds the trimmed company summary card", () => {
    const dto = mapDeal(companyRow);
    expect(dto.company).toEqual({
      id: companyRow.id,
      name: "Acme Inc",
      domain: "acme.com",
      sector: "AI/ML",
      location: "San Francisco",
      logoUrl: "https://cdn/acme.png",
      description: "Rocket ships",
      employeeCount: 24,
      foundedYear: 2020,
    });
    expect(dto.title).toBe("Acme Inc");
    expect((dto.company as { tags?: unknown }).tags).toBeUndefined();
  });
});

describe("mapStage / mapPipeline", () => {
  const stage = {
    id: "44444444-4444-4444-4444-444444444444",
    pipelineId: "33333333-3333-3333-3333-333333333333",
    name: "Sourcing",
    color: "#6366f1",
    kind: "active",
    position: 0,
  } as unknown as StageRow;

  it("maps stage columns verbatim", () => {
    expect(mapStage(stage)).toEqual({
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: "Sourcing",
      color: "#6366f1",
      kind: "active",
      position: 0,
    });
  });

  it("maps a pipeline with its stages in order", () => {
    const won = { ...stage, id: "55555555-5555-5555-5555-555555555555", kind: "won", position: 9 };
    const dto = mapPipeline(
      { id: stage.pipelineId, name: "Main", isDefault: true, position: 0 } as unknown as PipelineRow,
      [stage, won] as unknown as Parameters<typeof mapPipeline>[1],
    );
    expect(dto.name).toBe("Main");
    expect(dto.isDefault).toBe(true);
    expect(dto.stages.map((s) => s.kind)).toEqual(["active", "won"]);
  });
});

describe("mapCustomField", () => {
  it("preserves options and flags", () => {
    const row = {
      id: "66666666-6666-6666-6666-666666666666",
      target: "company",
      key: "sector",
      label: "Sector",
      type: "select",
      options: ["AI", "Fin"],
      isRequired: false,
      showInTable: true,
      aiExtractable: true,
      position: 3,
    } as unknown as CustomFieldRow;
    expect(mapCustomField(row)).toMatchObject({ options: ["AI", "Fin"], aiExtractable: true });
  });

  it("normalizes missing options to null", () => {
    const row = { options: null } as unknown as CustomFieldRow;
    expect(mapCustomField(row).options).toBeNull();
  });
});

describe("mapDocument", () => {
  it("maps document metadata with iso timestamps", () => {
    const dto = mapDocument({
      id: "77777777-7777-7777-7777-777777777777",
      companyId: companyRow.id,
      dealId: null,
      name: "deck.pdf",
      mime: "application/pdf",
      sizeBytes: 1024,
      pageCount: 18,
      sourceUrl: null,
      source: "upload",
      parseStatus: "parsed",
      createdAt: NOW,
    } as unknown as DocumentRow);
    expect(dto.pageCount).toBe(18);
    expect(dto.createdAt).toBe("2026-08-01T12:00:00.000Z");
    expect(dto.dealId).toBeNull();
  });
});

describe("mapEmail", () => {
  const emailRow = {
    id: "88888888-8888-8888-8888-888888888888",
    direction: "inbound",
    channel: "imap",
    fromEmail: "founder@acme.com",
    fromName: "Founder",
    toEmails: ["partner@fund.com"],
    subject: "Deck attached",
    bodyText: "Raising $10M",
    receivedAt: NOW,
    processingStatus: "processed",
    processedResult: undefined,
    error: null,
  } as unknown as EmailRow;

  it("defaults null recipients to [] and unprocessed results to null", () => {
    const dto = mapEmail(emailRow);
    expect(dto.toEmails).toEqual(["partner@fund.com"]);
    expect(dto.processedResult).toBeNull();
  });

  it("passes through triage payloads when present", () => {
    const dto = mapEmail({
      ...emailRow,
      processedResult: { intent: "fundraise" },
      toEmails: null,
    } as unknown as EmailRow);
    expect(dto.processedResult).toEqual({ intent: "fundraise" });
    expect(dto.toEmails).toEqual([]);
  });
});

describe("mapNote", () => {
  const noteRow = {
    id: "99999999-9999-9999-9999-999999999999",
    authorUserId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    companyId: companyRow.id,
    dealId: null,
    body: "Great team",
    pinned: true,
    createdAt: NOW,
  } as unknown as NoteRow;

  it("attaches the resolved author display name when provided", () => {
    expect(mapNote(noteRow, "Jo Partner").authorName).toBe("Jo Partner");
  });

  it("falls back to null author names", () => {
    expect(mapNote(noteRow).authorName).toBeNull();
    expect(mapNote(noteRow, null).authorName).toBeNull();
  });
});

describe("mapActivity", () => {
  const activityRow = {
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    entityType: "deal",
    entityId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    companyId: companyRow.id,
    dealId: null,
    type: "deal.created",
    actor: "system",
    actorUserId: null,
    summary: "Pitch submitted via intake form",
    data: undefined,
    createdAt: NOW,
  } as unknown as ActivityRow;

  it("normalizes missing jsonb payload to null", () => {
    const dto = mapActivity(activityRow);
    expect(dto.data).toBeNull();
    expect(dto.summary).toBe("Pitch submitted via intake form");
  });

  it("keeps structured payloads intact", () => {
    expect(mapActivity({ ...activityRow, data: { form: "apply" } }).data).toEqual({
      form: "apply",
    });
  });
});
