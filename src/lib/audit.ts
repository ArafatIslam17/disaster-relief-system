import "server-only";
import type { Prisma } from "@prisma/client";

export type Tx = Prisma.TransactionClient;

export type AuditEntry = {
  userId?: string | null;
  organisationId?: string | null;
  deviceId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  oldValue?: Prisma.InputJsonValue | null;
  newValue?: Prisma.InputJsonValue | null;
};

/** Append a row to AUDIT_LOG. Always call inside the same transaction as the change it records. */
export async function writeAudit(tx: Tx, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      organisationId: entry.organisationId ?? null,
      deviceId: entry.deviceId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: entry.oldValue ?? undefined,
      newValue: entry.newValue ?? undefined,
    },
  });
}
