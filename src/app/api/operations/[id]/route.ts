import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { activeCoordinatorIds, notifyUsers } from "@/lib/notify";
import { getOperation } from "@/lib/operations";
import { uuid } from "@/lib/validation";

type Params = { id: string };

export const GET = route<Params>(async (req, { params }) => {
  await requirePermission(req, "operation.read");
  const op = await getOperation(uuid.parse(params.id));
  const [areas, reliefItems, memberships] = await Promise.all([
    prisma.area.findMany({ where: { operationId: op.operationId }, orderBy: [{ upazila: "asc" }, { unionName: "asc" }, { ward: "asc" }] }),
    prisma.reliefItem.findMany({ where: { operationId: op.operationId }, orderBy: { itemName: "asc" } }),
    prisma.operationMembership.findMany({ where: { operationId: op.operationId }, include: { organisation: { select: { name: true, status: true } } }, orderBy: { requestedAt: "asc" } }),
  ]);
  return ok({ operation: op, areas, reliefItems, memberships });
});

const patchSchema = z.object({ action: z.literal("close") });

/** UC-09: close an operation. Closed operations reject sync and setup changes (State Diagram 03). */
export const PATCH = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "operation.manage");
  await parseJson(req, patchSchema);
  const op = await getOperation(uuid.parse(params.id));
  if (op.status === "Closed") throw conflict("Operation is already closed.");
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.operation.updateMany({
      where: { operationId: op.operationId, status: "Active" },
      data: { status: "Closed", closedAt: now, endDate: new Date(now.toISOString().slice(0, 10)) },
    });
    if (res.count !== 1) throw conflict("Operation is already closed.");
    await writeAudit(tx, { userId: auth.userId, action: "OPERATION_CLOSED", entityType: "OPERATION", entityId: op.operationId, oldValue: { status: "Active" }, newValue: { status: "Closed", closedAt: now.toISOString() } });
    const members = await tx.operationMembership.findMany({ where: { operationId: op.operationId, status: "Approved" }, select: { organisationId: true } });
    await notifyUsers(tx, await activeCoordinatorIds(tx, members.map((m) => m.organisationId)), {
      type: "OPERATION_CLOSED",
      message: `${op.name} has been closed. Field devices can no longer sync to it.`,
      linkPath: "/dashboard/operations",
    });
    return tx.operation.findUniqueOrThrow({ where: { operationId: op.operationId } });
  });
  return ok({ operation: updated });
});
