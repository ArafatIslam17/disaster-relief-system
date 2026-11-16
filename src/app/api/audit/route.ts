import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { csvResponse, toCsv } from "@/lib/csv";
import { uuid } from "@/lib/validation";

const query = z.object({
  action: z.string().trim().max(60).optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.string().trim().max(100).optional(),
  userId: uuid.optional(),
  deviceId: uuid.optional(),
  organisationId: uuid.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  format: z.enum(["json", "csv"]).default("json"),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: uuid.optional(),
});

const CSV_MAX_ROWS = 50_000;

/**
 * Read-only audit trail with filters and CSV export. There are deliberately no POST/PATCH/DELETE
 * handlers: AUDIT_LOG is append-only and enforced by a database trigger. Coordinators see entries
 * for their own organisation only.
 */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "audit.read");
  const q = parseQuery(req, query);
  const where: Prisma.AuditLogWhereInput = {
    action: q.action,
    entityType: q.entityType,
    entityId: q.entityId,
    userId: q.userId,
    deviceId: q.deviceId,
    organisationId: auth.role === "GROUP_COORDINATOR" ? auth.organisationId : q.organisationId,
    createdAt: q.from || q.to ? { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } : undefined,
  };
  const include = { user: { select: { fullName: true, role: true } }, organisation: { select: { name: true } }, device: { select: { deviceLabel: true } } } as const;

  if (q.format === "csv") {
    const rows = await prisma.auditLog.findMany({ where, include, orderBy: [{ createdAt: "desc" }, { auditId: "desc" }], take: CSV_MAX_ROWS });
    const csv = toCsv(
      rows.map((r) => ({
        audit_id: r.auditId,
        created_at: r.createdAt.toISOString(),
        action: r.action,
        entity_type: r.entityType,
        entity_id: r.entityId,
        user: r.user?.fullName ?? "",
        role: r.user?.role ?? "",
        organisation: r.organisation?.name ?? "",
        device: r.device?.deviceLabel ?? "",
        old_value: r.oldValue === null ? "" : JSON.stringify(r.oldValue),
        new_value: r.newValue === null ? "" : JSON.stringify(r.newValue),
      })),
      ["audit_id", "created_at", "action", "entity_type", "entity_id", "user", "role", "organisation", "device", "old_value", "new_value"],
    );
    return csvResponse(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  const rows = await prisma.auditLog.findMany({
    where,
    include,
    orderBy: [{ createdAt: "desc" }, { auditId: "desc" }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { auditId: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return ok({ entries: page, nextCursor: hasMore ? page[page.length - 1].auditId : null });
});
