import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { env } from "./env";
import { writeAudit } from "./audit";

const PII_JSON_KEYS = ["headName", "mobileNumber", "gpsLocation", "localValue", "serverValue", "resolvedValue"];

/**
 * NFR07: redact household PII for operations Closed more than PII_RETENTION_DAYS (90) ago.
 * Household rows survive (coverage and distribution history stay intact) with
 * head_name='[REDACTED]', mobile_number=NULL, gps_location=NULL. Version history, conflict values,
 * household sync payloads and audit JSON are redacted in the same transaction, under the
 * `app.pii_purge` flag that the append-only triggers recognise (they still forbid DELETE).
 */
export async function purgeExpiredPii(actorUserId: string, opts: { dryRun: boolean }) {
  const cutoff = new Date(Date.now() - env().PII_RETENTION_DAYS * 86_400_000);
  const ops = await prisma.operation.findMany({
    where: { status: "Closed", closedAt: { lte: cutoff }, piiPurgedAt: null },
    select: { operationId: true, name: true, closedAt: true },
  });

  const results = [];
  for (const op of ops) {
    const households = await prisma.household.findMany({ where: { area: { operationId: op.operationId } }, select: { householdId: true } });
    const ids = households.map((h) => h.householdId);
    if (opts.dryRun) {
      results.push({ operationId: op.operationId, name: op.name, closedAt: op.closedAt, households: ids.length, purged: false });
      continue;
    }
    const counts = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL app.pii_purge = 'on'");
        const idList = ids.length ? Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`)) : Prisma.sql`NULL::uuid`;
        const idText = ids.length ? Prisma.join(ids) : Prisma.sql`NULL`;
        const hh = await tx.$executeRaw`
          UPDATE household SET head_name = '[REDACTED]', mobile_number = NULL, gps_location = NULL, updated_at = now()
          WHERE household_id IN (${idList})`;
        const versions = await tx.$executeRaw`
          UPDATE household_version SET head_name = '[REDACTED]', mobile_number = NULL
          WHERE household_id IN (${idList}) AND (head_name <> '[REDACTED]' OR mobile_number IS NOT NULL)`;
        const conflicts = await tx.$executeRaw`
          UPDATE conflict SET
            local_value = CASE WHEN field_name IN ('head_name','mobile_number') THEN '[REDACTED]' ELSE local_value END,
            server_value = CASE WHEN field_name IN ('head_name','mobile_number') THEN '[REDACTED]' ELSE server_value END,
            resolved_value = CASE WHEN field_name IN ('head_name','mobile_number') AND resolved_value IS NOT NULL THEN '[REDACTED]' ELSE resolved_value END
          WHERE household_id IN (${idList})`;
        const syncEvents = await tx.$executeRaw`
          UPDATE sync_event SET payload = '{"piiRedacted": true}'::jsonb
          WHERE entity_type = 'HOUSEHOLD' AND entity_id IN (${idList})`;
        const keys = Prisma.raw(PII_JSON_KEYS.map((k) => `- '${k}'`).join(" "));
        const audits = await tx.$executeRaw`
          UPDATE audit_log SET
            old_value = CASE WHEN jsonb_typeof(old_value) = 'object' THEN (old_value ${keys}) || '{"piiRedacted": true}'::jsonb ELSE old_value END,
            new_value = CASE WHEN jsonb_typeof(new_value) = 'object' THEN (new_value ${keys}) || '{"piiRedacted": true}'::jsonb ELSE new_value END
          WHERE (entity_type = 'HOUSEHOLD' AND entity_id IN (${idText}))
             OR (entity_type = 'CONFLICT' AND entity_id IN (SELECT conflict_id::text FROM conflict WHERE household_id IN (${idList})))`;
        await tx.operation.update({ where: { operationId: op.operationId }, data: { piiPurgedAt: new Date() } });
        await writeAudit(tx, {
          userId: actorUserId,
          action: "PII_PURGED",
          entityType: "OPERATION",
          entityId: op.operationId,
          newValue: { households: hh, householdVersions: versions, conflicts, syncEvents, auditRows: audits, retentionDays: env().PII_RETENTION_DAYS },
        });
        return { households: hh, householdVersions: versions, conflicts, syncEvents, auditRows: audits };
      },
      { timeout: 120_000 },
    );
    results.push({ operationId: op.operationId, name: op.name, closedAt: op.closedAt, ...counts, purged: true });
  }
  return { cutoff: cutoff.toISOString(), dryRun: opts.dryRun, operations: results };
}
