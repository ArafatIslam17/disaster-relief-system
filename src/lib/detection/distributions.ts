import "server-only";
import type { Tx } from "../audit";
import { writeAudit } from "../audit";
import { env } from "../env";
import { activeCoordinatorIds, activeRoleIds, notifyUsers } from "../notify";

/** Household ids treated as the same family: the household plus any Linked duplicates. */
export async function linkedHouseholdIds(tx: Tx, householdId: string): Promise<string[]> {
  const pairs = await tx.duplicatePair.findMany({
    where: { status: "Linked", OR: [{ householdAId: householdId }, { householdBId: householdId }] },
    select: { householdAId: true, householdBId: true },
  });
  return [...new Set([householdId, ...pairs.flatMap((p) => [p.householdAId, p.householdBId])])];
}

/**
 * DuplicateDetector.checkDistribution(d) — FR20.
 * Flags when the same household (or a Linked duplicate) received the same relief item from two
 * different organisations within REPEAT_DISTRIBUTION_WINDOW_HOURS. Runs inside the transaction
 * that records the distribution so the flag can never be lost.
 */
export async function checkDistribution(tx: Tx, distributionId: string): Promise<string[]> {
  const d = await tx.distribution.findUnique({
    where: { distributionId },
    include: { items: { select: { itemId: true } }, recordedByUser: { select: { organisationId: true } }, household: { select: { shortCode: true } } },
  });
  if (!d || !d.householdId || d.status !== "Active" || !d.recordedByUser.organisationId) return [];

  const windowMs = env().REPEAT_DISTRIBUTION_WINDOW_HOURS * 3600_000;
  const householdIds = await linkedHouseholdIds(tx, d.householdId);
  const itemIds = d.items.map((i) => i.itemId);

  const others = await tx.distribution.findMany({
    where: {
      distributionId: { not: d.distributionId },
      householdId: { in: householdIds },
      status: "Active",
      distributedAt: { gte: new Date(d.distributedAt.getTime() - windowMs), lte: new Date(d.distributedAt.getTime() + windowMs) },
      recordedByUser: { organisationId: { not: d.recordedByUser.organisationId } },
      items: { some: { itemId: { in: itemIds } } },
    },
    include: { recordedByUser: { select: { organisationId: true } } },
  });

  const created: string[] = [];
  for (const o of others) {
    const [first, second] =
      o.distributedAt < d.distributedAt || (o.distributedAt.getTime() === d.distributedAt.getTime() && o.distributionId < d.distributionId)
        ? [o, d]
        : [d, o];
    const exists = await tx.distributionFlag.findFirst({
      where: {
        OR: [
          { firstDistributionId: first.distributionId, secondDistributionId: second.distributionId },
          { firstDistributionId: second.distributionId, secondDistributionId: first.distributionId },
        ],
      },
      select: { flagId: true },
    });
    if (exists) continue;
    const flag = await tx.distributionFlag.create({
      data: { firstDistributionId: first.distributionId, secondDistributionId: second.distributionId, status: "PendingReview" },
    });
    created.push(flag.flagId);
    const hours = Math.abs(d.distributedAt.getTime() - o.distributedAt.getTime()) / 3600_000;
    await writeAudit(tx, {
      action: "DISTRIBUTION_FLAGGED",
      entityType: "DISTRIBUTION_FLAG",
      entityId: flag.flagId,
      newValue: { shortCode: d.household?.shortCode ?? null, hoursApart: Math.round(hours * 100) / 100, organisationIds: [d.recordedByUser.organisationId, o.recordedByUser.organisationId] },
    });
    const recipients = [
      ...(await activeCoordinatorIds(tx, [d.recordedByUser.organisationId, o.recordedByUser.organisationId])),
      ...(await activeRoleIds(tx, "OPERATION_ADMINISTRATOR")),
    ];
    await notifyUsers(tx, recipients, {
      type: "DISTRIBUTION_FLAG",
      message: `${d.household?.shortCode ?? "A household"} received the same item from two organisations within ${env().REPEAT_DISTRIBUTION_WINDOW_HOURS} hours.`,
      linkPath: `/flags/${flag.flagId}`,
    });
  }
  return created;
}
