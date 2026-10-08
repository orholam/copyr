import { and, eq, inArray } from "drizzle-orm";
import { dealParticipants } from "@copyr/db/schema.js";
import type { DealParticipantDto, ParticipantInput } from "@copyr/contracts";
import type { CoreContext, Session } from "../context.js";
import { toIso } from "../mappers.js";

type Exec = CoreContext["db"] | Parameters<Parameters<CoreContext["db"]["transaction"]>[0]>[0];

export interface SyndicatePeople {
  submittedBy: DealParticipantDto | null;
  upvoters: DealParticipantDto[];
}

function mapRow(row: typeof dealParticipants.$inferSelect): DealParticipantDto {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    firm: row.firm,
    email: row.email,
    occurredAt: toIso(row.occurredAt),
  };
}

export async function loadSyndicatePeople(
  exec: Exec,
  companyIds: string[],
): Promise<Map<string, SyndicatePeople>> {
  const out = new Map<string, SyndicatePeople>();
  if (!companyIds.length) return out;
  const rows = await exec
    .select()
    .from(dealParticipants)
    .where(inArray(dealParticipants.companyId, companyIds));
  for (const row of rows) {
    const bucket = out.get(row.companyId) ?? { submittedBy: null, upvoters: [] };
    const dto = mapRow(row);
    if (row.role === "submitter") bucket.submittedBy = dto;
    else bucket.upvoters.push(dto);
    out.set(row.companyId, bucket);
  }
  for (const bucket of out.values()) {
    bucket.upvoters.sort((a, b) => (a.occurredAt ?? "").localeCompare(b.occurredAt ?? ""));
  }
  return out;
}

export async function replaceParticipants(
  exec: Exec,
  session: Session,
  companyId: string,
  input: { submittedBy?: ParticipantInput | null; upvoters?: ParticipantInput[] },
): Promise<void> {
  if (input.submittedBy !== undefined) {
    await exec
      .delete(dealParticipants)
      .where(
        and(
          eq(dealParticipants.companyId, companyId),
          eq(dealParticipants.workspaceId, session.workspaceId),
          eq(dealParticipants.role, "submitter"),
        ),
      );
    if (input.submittedBy) {
      await exec.insert(dealParticipants).values({
        workspaceId: session.workspaceId,
        companyId,
        role: "submitter",
        name: input.submittedBy.name,
        firm: input.submittedBy.firm ?? null,
        email: input.submittedBy.email ?? null,
        occurredAt: input.submittedBy.occurredAt ? new Date(input.submittedBy.occurredAt) : null,
      });
    }
  }
  if (input.upvoters !== undefined) {
    await exec
      .delete(dealParticipants)
      .where(
        and(
          eq(dealParticipants.companyId, companyId),
          eq(dealParticipants.workspaceId, session.workspaceId),
          eq(dealParticipants.role, "upvote"),
        ),
      );
    if (input.upvoters.length) {
      await exec.insert(dealParticipants).values(
        input.upvoters.map((p) => ({
          workspaceId: session.workspaceId,
          companyId,
          role: "upvote" as const,
          name: p.name,
          firm: p.firm ?? null,
          email: p.email ?? null,
          occurredAt: p.occurredAt ? new Date(p.occurredAt) : null,
        })),
      );
    }
  }
}
