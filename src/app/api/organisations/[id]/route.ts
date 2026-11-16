import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, notFound } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { uuid } from "@/lib/validation";

type Params = { id: string };

const schema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("reject"), rejectionReason: z.string().trim().min(5, "Give a rejection reason.").max(500) }),
]);

/**
 * UC-04 / State Diagram 01: approve or reject a Pending organisation. Approval activates the
 * organisation's initial Group Coordinator(s); rejection deactivates its pending accounts.
 */
export const PATCH = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "organisation.review");
  const body = await parseJson(req, schema);
  const organisationId = uuid.parse(params.id);
  const org = await prisma.organisation.findUnique({ where: { organisationId } });
  if (!org) throw notFound("Organisation");
  if (org.status !== "Pending") throw conflict(`Organisation is already ${org.status}.`);

  const result = await prisma.$transaction(async (tx) => {
    const status = body.decision === "approve" ? "Approved" : "Rejected";
    const res = await tx.organisation.updateMany({
      where: { organisationId, status: "Pending" },
      data: { status, rejectionReason: body.decision === "reject" ? body.rejectionReason : null },
    });
    if (res.count !== 1) throw conflict("Organisation was reviewed by someone else.");
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId,
      action: body.decision === "approve" ? "ORGANISATION_APPROVED" : "ORGANISATION_REJECTED",
      entityType: "ORGANISATION",
      entityId: organisationId,
      oldValue: { status: "Pending" },
      newValue: { status, ...(body.decision === "reject" ? { rejectionReason: body.rejectionReason } : {}) },
    });

    const pending = await tx.user.findMany({
      where: { organisationId, status: "PendingApproval", ...(body.decision === "approve" ? { role: "GROUP_COORDINATOR" as const } : {}) },
      select: { userId: true },
    });
    const newUserStatus = body.decision === "approve" ? "Active" : "Deactivated";
    for (const u of pending) {
      await tx.user.update({ where: { userId: u.userId }, data: { status: newUserStatus } });
      await writeAudit(tx, {
        userId: auth.userId,
        organisationId,
        action: body.decision === "approve" ? "USER_APPROVED" : "USER_REJECTED",
        entityType: "USER",
        entityId: u.userId,
        oldValue: { status: "PendingApproval" },
        newValue: { status: newUserStatus, reason: `Organisation ${status.toLowerCase()}` },
      });
    }
    await notifyUsers(tx, pending.map((u) => u.userId), {
      type: body.decision === "approve" ? "ORGANISATION_APPROVED" : "ORGANISATION_REJECTED",
      message: body.decision === "approve" ? `${org.name} has been approved. You can now sign in.` : `${org.name} was not approved: ${body.decision === "reject" ? body.rejectionReason : ""}`,
      linkPath: "/login",
    });
    return { status, usersUpdated: pending.length };
  });

  return ok({ organisationId, ...result });
});
