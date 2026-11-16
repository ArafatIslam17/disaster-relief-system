import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { activeCoordinatorIds, notifyUsers } from "@/lib/notify";
import { checkDistribution } from "@/lib/detection/distributions";
import { uuid } from "@/lib/validation";

type Params = { id: string };

const schema = z.object({ action: z.enum(["confirmLink", "markNotDuplicate", "undoLink"]) });

const TRANSITIONS = {
  confirmLink: { from: "PendingReview", to: "Linked" },
  markNotDuplicate: { from: "PendingReview", to: "NotDuplicate" },
  undoLink: { from: "Linked", to: "PendingReview" },
} as const;

/**
 * State Diagram 06 transitions. Linking makes the two households one family for repeat-distribution
 * checks, so existing distributions are re-checked for cross-organisation repeats (FR20).
 */
export const POST = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "duplicate.review");
  const { action } = await parseJson(req, schema);
  const pairId = uuid.parse(params.id);
  const pair = await prisma.duplicatePair.findUnique({
    where: { pairId },
    include: {
      householdA: { select: { householdId: true, shortCode: true, registeredByUser: { select: { organisationId: true } } } },
      householdB: { select: { householdId: true, shortCode: true, registeredByUser: { select: { organisationId: true } } } },
    },
  });
  if (!pair) throw notFound("Duplicate pair");
  const orgs = [pair.householdA.registeredByUser.organisationId, pair.householdB.registeredByUser.organisationId];
  if (auth.role === "GROUP_COORDINATOR" && !orgs.includes(auth.organisationId)) throw forbidden();

  const t = TRANSITIONS[action];
  if (pair.status !== t.from) throw conflict(`Cannot ${action} a pair that is ${pair.status}.`);

  const result = await prisma.$transaction(async (tx) => {
    const reviewed = t.to === "PendingReview" ? { reviewedBy: null, reviewedAt: null } : { reviewedBy: auth.userId, reviewedAt: new Date() };
    const res = await tx.duplicatePair.updateMany({ where: { pairId, status: t.from }, data: { status: t.to, ...reviewed } });
    if (res.count !== 1) throw conflict("Pair was reviewed by someone else.");
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: auth.organisationId,
      action: `DUPLICATE_${action === "confirmLink" ? "LINKED" : action === "markNotDuplicate" ? "MARKED_NOT_DUPLICATE" : "LINK_UNDONE"}`,
      entityType: "DUPLICATE_PAIR",
      entityId: pairId,
      oldValue: { status: t.from },
      newValue: { status: t.to },
    });

    let flagIds: string[] = [];
    if (action === "confirmLink") {
      const dists = await tx.distribution.findMany({
        where: { householdId: { in: [pair.householdAId, pair.householdBId] }, status: "Active" },
        select: { distributionId: true },
      });
      for (const d of dists) flagIds = flagIds.concat(await checkDistribution(tx, d.distributionId));
    }
    const others = (await activeCoordinatorIds(tx, orgs)).filter((id) => id !== auth.userId);
    await notifyUsers(tx, others, {
      type: "DUPLICATE_REVIEWED",
      message: `Duplicate pair ${pair.householdA.shortCode} / ${pair.householdB.shortCode} is now ${t.to}.`,
      linkPath: `/dashboard/duplicates?pair=${pairId}`,
    });
    return { flagIds };
  });

  return ok({ pairId, status: t.to, ...result });
});
