import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { householdSelect, serializeHousehold } from "@/lib/serializers";
import { mobileMatch } from "@/lib/detection/similarity";
import { uuid } from "@/lib/validation";

const query = z.object({
  status: z.enum(["PendingReview", "Linked", "NotDuplicate"]).default("PendingReview"),
  operationId: uuid.optional(),
});

/** UC-18 / State Diagram 06: duplicate review queue, highest score first. */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "duplicate.review");
  const q = parseQuery(req, query);
  const opFilter: Prisma.HouseholdWhereInput = q.operationId ? { area: { operationId: q.operationId } } : {};
  const orgFilter: Prisma.DuplicatePairWhereInput =
    auth.role === "GROUP_COORDINATOR"
      ? { OR: [{ householdA: { registeredByUser: { organisationId: auth.organisationId } } }, { householdB: { registeredByUser: { organisationId: auth.organisationId } } }] }
      : {};
  const hhSelect = { ...householdSelect, area: true, registeredByUser: { select: { organisationId: true, organisation: { select: { name: true } } } } } as const;
  const pairs = await prisma.duplicatePair.findMany({
    where: { status: q.status, householdA: opFilter, ...orgFilter },
    orderBy: [{ score: "desc" }, { pairId: "asc" }],
    include: { householdA: { select: hhSelect }, householdB: { select: hhSelect }, reviewedByUser: { select: { fullName: true } } },
  });
  return ok({
    pairs: pairs.map((p) => ({
      pairId: p.pairId,
      score: p.score.toFixed(2),
      label: p.label,
      status: p.status,
      reviewedBy: p.reviewedByUser?.fullName ?? null,
      reviewedAt: p.reviewedAt,
      mobileMatch: mobileMatch(p.householdA.mobileNumber, p.householdB.mobileNumber),
      householdA: { ...serializeHousehold(auth, p.householdA), area: p.householdA.area, organisation: p.householdA.registeredByUser.organisation?.name ?? null },
      householdB: { ...serializeHousehold(auth, p.householdB), area: p.householdB.area, organisation: p.householdB.registeredByUser.organisation?.name ?? null },
    })),
  });
});
