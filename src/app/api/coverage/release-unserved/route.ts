import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, notFound } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { assertApprovedMembership, assertOperationActive, getOperation } from "@/lib/operations";
import { uuid } from "@/lib/validation";

const schema = z.object({ areaId: uuid });

/**
 * UC-21: snapshot the unserved households of an area and push the list to field devices via the
 * next /api/sync delta (`releasedUnservedLists`). Field volunteers of approved member
 * organisations are notified.
 */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "coverage.release");
  const { areaId } = await parseJson(req, schema);
  const area = await prisma.area.findUnique({ where: { areaId } });
  if (!area) throw notFound("Area");
  const op = await getOperation(area.operationId);
  assertOperationActive(op);
  if (auth.role === "GROUP_COORDINATOR") await assertApprovedMembership(op.operationId, auth.organisationId);

  const unserved = await prisma.household.findMany({
    where: { areaId, distributions: { none: { status: "Active" } } },
    select: { householdId: true },
    orderBy: { shortCode: "asc" },
  });
  if (unserved.length === 0) throw conflict("Every registered household in this area has been served; there is nothing to release.");

  const release = await prisma.$transaction(async (tx) => {
    const r = await tx.unservedRelease.create({
      data: { operationId: op.operationId, areaId, releasedBy: auth.userId, householdIds: unserved.map((h) => h.householdId) },
    });
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: auth.organisationId,
      action: "UNSERVED_LIST_RELEASED",
      entityType: "AREA",
      entityId: areaId,
      newValue: { releaseId: r.releaseId, households: unserved.length },
    });
    const memberOrgs = await tx.operationMembership.findMany({ where: { operationId: op.operationId, status: "Approved" }, select: { organisationId: true } });
    const volunteers = await tx.user.findMany({
      where: { organisationId: { in: memberOrgs.map((m) => m.organisationId) }, role: "FIELD_VOLUNTEER", status: "Active" },
      select: { userId: true },
    });
    await notifyUsers(tx, volunteers.map((v) => v.userId), {
      type: "UNSERVED_LIST_RELEASED",
      message: `${unserved.length} unserved households in ${area.unionName}, Ward ${area.ward} are ready on your device after the next sync.`,
      linkPath: "/field/unserved",
    });
    return r;
  });

  return ok({ releaseId: release.releaseId, areaId, households: unserved.length, releasedAt: release.releasedAt }, { status: 201 });
});
