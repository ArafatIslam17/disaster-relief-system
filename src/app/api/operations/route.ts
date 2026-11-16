import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { isoDate } from "@/lib/validation";

export const GET = route(async (req) => {
  const auth = await requirePermission(req, "operation.read");
  const ops = await prisma.operation.findMany({
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: {
      _count: { select: { areas: true, reliefItems: true } },
      memberships: auth.organisationId ? { where: { organisationId: auth.organisationId }, select: { status: true, requestedAt: true, reviewedAt: true } } : false,
    },
  });
  return ok({
    operations: ops.map((o) => ({
      operationId: o.operationId,
      name: o.name,
      disasterType: o.disasterType,
      startDate: o.startDate.toISOString().slice(0, 10),
      endDate: o.endDate?.toISOString().slice(0, 10) ?? null,
      status: o.status,
      closedAt: o.closedAt?.toISOString() ?? null,
      piiPurgedAt: o.piiPurgedAt?.toISOString() ?? null,
      areaCount: o._count.areas,
      reliefItemCount: o._count.reliefItems,
      myMembership: o.memberships?.[0] ?? null,
    })),
  });
});

const createSchema = z.object({
  name: z.string().trim().min(5).max(150),
  disasterType: z.string().trim().min(3).max(60),
  startDate: isoDate,
});

/** UC-06: create an operation. */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "operation.manage");
  const body = await parseJson(req, createSchema);
  const op = await prisma.$transaction(async (tx) => {
    const o = await tx.operation.create({ data: { name: body.name, disasterType: body.disasterType, startDate: body.startDate, status: "Active" } });
    await writeAudit(tx, { userId: auth.userId, action: "OPERATION_CREATED", entityType: "OPERATION", entityId: o.operationId, newValue: { name: o.name, disasterType: o.disasterType, startDate: body.startDate.toISOString().slice(0, 10), status: "Active" } });
    return o;
  });
  return ok({ operationId: op.operationId, status: op.status }, { status: 201 });
});
