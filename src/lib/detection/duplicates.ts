import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { writeAudit } from "../audit";
import { activeCoordinatorIds, notifyUsers } from "../notify";
import { householdSimilarity, type HouseholdFeatures } from "./similarity";

export type ScoreResult = { compared: number; created: number; updated: number; pairIds: string[] };

/**
 * DuplicateDetector.scoreHouseholds(union_name) — Class Diagram Fig 5.16.
 * Compares each target household against every other household registered in the same union of
 * the same operation. Pairs at or above the "Possible" threshold are upserted (canonical a < b);
 * pairs already reviewed (Linked / NotDuplicate) are never reopened. Coordinators of both
 * registering organisations are notified of newly created pairs (State Diagram 06).
 */
export async function scoreHouseholds(args: { operationId: string; unionName: string; householdIds?: string[] }): Promise<ScoreResult> {
  const { DUPLICATE_LIKELY_THRESHOLD: likely, DUPLICATE_POSSIBLE_THRESHOLD: possible } = env();

  const pool = await prisma.household.findMany({
    where: { area: { operationId: args.operationId, unionName: args.unionName }, headName: { not: "[REDACTED]" } },
    select: {
      householdId: true,
      shortCode: true,
      headName: true,
      mobileNumber: true,
      memberCount: true,
      areaId: true,
      area: { select: { ward: true, unionName: true } },
      registeredByUser: { select: { organisationId: true } },
    },
  });
  const targets = args.householdIds ? pool.filter((h) => args.householdIds!.includes(h.householdId)) : pool;
  const features = (h: (typeof pool)[number]): HouseholdFeatures => ({
    headName: h.headName,
    mobileNumber: h.mobileNumber,
    memberCount: h.memberCount,
    areaId: h.areaId,
    ward: h.area.ward,
  });

  const result: ScoreResult = { compared: 0, created: 0, updated: 0, pairIds: [] };
  const seen = new Set<string>();

  for (const t of targets) {
    for (const o of pool) {
      if (o.householdId === t.householdId) continue;
      const [a, b] = t.householdId < o.householdId ? [t, o] : [o, t];
      const key = `${a.householdId}:${b.householdId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.compared++;

      const { score } = householdSimilarity(features(a), features(b));
      if (score < possible) continue;
      const label = score >= likely ? "Likely" : "Possible";

      await prisma.$transaction(async (tx) => {
        const existing = await tx.duplicatePair.findUnique({
          where: { householdAId_householdBId: { householdAId: a.householdId, householdBId: b.householdId } },
        });
        if (existing) {
          if (existing.status !== "PendingReview") return;
          if (existing.score.toFixed(2) === score.toFixed(2)) return;
          await tx.duplicatePair.update({ where: { pairId: existing.pairId }, data: { score: new Prisma.Decimal(score.toFixed(2)), label } });
          result.updated++;
          result.pairIds.push(existing.pairId);
          return;
        }
        const pair = await tx.duplicatePair.create({
          data: { householdAId: a.householdId, householdBId: b.householdId, score: new Prisma.Decimal(score.toFixed(2)), label, status: "PendingReview" },
        });
        result.created++;
        result.pairIds.push(pair.pairId);
        await writeAudit(tx, {
          action: "DUPLICATE_DETECTED",
          entityType: "DUPLICATE_PAIR",
          entityId: pair.pairId,
          newValue: { codes: [a.shortCode, b.shortCode], score: score.toFixed(2), label },
        });
        const coordinators = await activeCoordinatorIds(tx, [a.registeredByUser.organisationId, b.registeredByUser.organisationId]);
        await notifyUsers(tx, coordinators, {
          type: "DUPLICATE_REVIEW",
          message: `${label} duplicate (${score.toFixed(2)}): ${a.shortCode} and ${b.shortCode} in ${a.area.unionName}.`,
          linkPath: `/duplicates/${pair.pairId}`,
        });
      });
    }
  }
  return result;
}
