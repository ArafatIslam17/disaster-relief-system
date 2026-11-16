import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { uuid } from "@/lib/validation";

const query = z.object({
  status: z.enum(["PendingReview", "Justified", "Repeat"]).default("PendingReview"),
  operationId: uuid.optional(),
});

const distInclude = {
  household: { select: { shortCode: true } },
  area: true,
  items: { include: { item: { select: { itemName: true, unit: true } } } },
  recordedByUser: { select: { fullName: true, organisationId: true, organisation: { select: { name: true } } } },
} as const;

/** UC-19 / FR20: cross-organisation repeat-distribution flags. */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "flag.review");
  const q = parseQuery(req, query);
  const where: Prisma.DistributionFlagWhereInput = {
    status: q.status,
    ...(q.operationId ? { firstDistribution: { area: { operationId: q.operationId } } } : {}),
    ...(auth.role === "GROUP_COORDINATOR"
      ? { OR: [{ firstDistribution: { recordedByUser: { organisationId: auth.organisationId } } }, { secondDistribution: { recordedByUser: { organisationId: auth.organisationId } } }] }
      : {}),
  };
  const flags = await prisma.distributionFlag.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: { firstDistribution: { include: distInclude }, secondDistribution: { include: distInclude }, reviewedByUser: { select: { fullName: true } } },
  });
  const shape = (d: (typeof flags)[number]["firstDistribution"]) => ({
    distributionId: d.distributionId,
    distributedAt: d.distributedAt,
    status: d.status,
    organisation: d.recordedByUser.organisation?.name ?? null,
    recordedBy: d.recordedByUser.fullName,
    area: d.area,
    items: d.items.map((i) => ({ itemId: i.itemId, itemName: i.item.itemName, unit: i.item.unit, quantity: i.quantity })),
  });
  return ok({
    flags: flags.map((f) => {
      const a = new Set(f.firstDistribution.items.map((i) => i.itemId));
      return {
        flagId: f.flagId,
        status: f.status,
        note: f.note,
        createdAt: f.createdAt,
        reviewedBy: f.reviewedByUser?.fullName ?? null,
        reviewedAt: f.reviewedAt,
        shortCode: f.firstDistribution.household?.shortCode ?? f.secondDistribution.household?.shortCode ?? null,
        hoursApart: Math.round((Math.abs(f.secondDistribution.distributedAt.getTime() - f.firstDistribution.distributedAt.getTime()) / 3600_000) * 100) / 100,
        sharedItems: f.secondDistribution.items.filter((i) => a.has(i.itemId)).map((i) => i.item.itemName),
        first: shape(f.firstDistribution),
        second: shape(f.secondDistribution),
      };
    }),
  });
});
