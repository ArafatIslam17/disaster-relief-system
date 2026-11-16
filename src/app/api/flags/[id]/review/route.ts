import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { activeCoordinatorIds, notifyUsers } from "@/lib/notify";
import { uuid } from "@/lib/validation";

type Params = { id: string };

const schema = z.object({
  status: z.enum(["Justified", "Repeat"]),
  note: z.string().trim().min(5, "Explain the decision in at least 5 characters.").max(1000),
});

/** UC-19: review a distribution flag as Justified (e.g. larger family, separate need) or Repeat. */
export const POST = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "flag.review");
  const body = await parseJson(req, schema);
  const flagId = uuid.parse(params.id);
  const flag = await prisma.distributionFlag.findUnique({
    where: { flagId },
    include: {
      firstDistribution: { select: { recordedByUser: { select: { organisationId: true } }, household: { select: { shortCode: true } } } },
      secondDistribution: { select: { recordedByUser: { select: { organisationId: true } } } },
    },
  });
  if (!flag) throw notFound("Distribution flag");
  const orgs = [flag.firstDistribution.recordedByUser.organisationId, flag.secondDistribution.recordedByUser.organisationId];
  if (auth.role === "GROUP_COORDINATOR" && !orgs.includes(auth.organisationId)) throw forbidden();
  if (flag.status !== "PendingReview") throw conflict(`Flag is already ${flag.status}.`);

  await prisma.$transaction(async (tx) => {
    const res = await tx.distributionFlag.updateMany({
      where: { flagId, status: "PendingReview" },
      data: { status: body.status, note: body.note, reviewedBy: auth.userId, reviewedAt: new Date() },
    });
    if (res.count !== 1) throw conflict("Flag was reviewed by someone else.");
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: auth.organisationId,
      action: "DISTRIBUTION_FLAG_REVIEWED",
      entityType: "DISTRIBUTION_FLAG",
      entityId: flagId,
      oldValue: { status: "PendingReview" },
      newValue: { status: body.status, note: body.note },
    });
    const others = (await activeCoordinatorIds(tx, orgs)).filter((id) => id !== auth.userId);
    await notifyUsers(tx, others, {
      type: "DISTRIBUTION_FLAG_REVIEWED",
      message: `Repeat-distribution flag on ${flag.firstDistribution.household?.shortCode ?? "a household"} was marked ${body.status}.`,
      linkPath: `/flags/${flagId}`,
    });
  });
  return ok({ flagId, status: body.status });
});
