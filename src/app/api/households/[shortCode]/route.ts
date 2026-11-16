import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, notFound } from "@/lib/errors";
import { assertOrgScope, requirePermission } from "@/lib/auth/guard";
import { mergeHouseholdChanges } from "@/lib/households";
import { assertOperationActive, getOperation } from "@/lib/operations";
import { householdSelect, serializeHousehold } from "@/lib/serializers";
import { visibleMobile } from "@/lib/privacy";
import { scoreHouseholds } from "@/lib/detection/duplicates";
import { headName, memberCount, optionalMobile } from "@/lib/validation";

type Params = { shortCode: string };

async function load(shortCode: string) {
  const h = await prisma.household.findUnique({
    where: { shortCode: shortCode.toUpperCase() },
    select: { ...householdSelect, area: true },
  });
  if (!h) throw notFound("Household");
  return h;
}

/** Household detail with append-only version history and distributions (UC-15 history view). */
export const GET = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "household.read");
  const h = await load(params.shortCode);
  const registrarOrg = h.registeredByUser.organisationId;
  const [versions, distributions, openConflicts, conflicts, pairs, flags] = await Promise.all([
    prisma.householdVersion.findMany({
      where: { householdId: h.householdId },
      orderBy: { version: "asc" },
      include: { changedByUser: { select: { fullName: true } } },
    }),
    prisma.distribution.findMany({
      where: { householdId: h.householdId },
      orderBy: { distributedAt: "desc" },
      include: { items: { include: { item: { select: { itemName: true, unit: true } } } }, recordedByUser: { select: { fullName: true, organisation: { select: { name: true } } } } },
    }),
    prisma.conflict.count({ where: { householdId: h.householdId, status: "Open" } }),
    prisma.conflict.findMany({
      where: { householdId: h.householdId },
      orderBy: { clientTime: "asc" },
      include: { localUser: { select: { fullName: true } }, resolvedByUser: { select: { fullName: true } }, event: { select: { receivedAt: true } } },
    }),
    prisma.duplicatePair.findMany({
      where: { OR: [{ householdAId: h.householdId }, { householdBId: h.householdId }] },
      include: { householdA: { select: { shortCode: true } }, householdB: { select: { shortCode: true } }, reviewedByUser: { select: { fullName: true } } },
    }),
    prisma.distributionFlag.findMany({
      where: { OR: [{ firstDistribution: { householdId: h.householdId } }, { secondDistribution: { householdId: h.householdId } }] },
      include: { reviewedByUser: { select: { fullName: true } } },
    }),
  ]);
  const maskConflictValue = (field: string, v: string | null) => (field === "mobile_number" ? visibleMobile(auth, registrarOrg, v).mobileNumber : v);
  return ok({
    household: { ...serializeHousehold(auth, h), area: h.area },
    openConflicts,
    versions: versions.map((v) => ({
      version: v.version,
      headName: v.headName,
      mobileNumber: visibleMobile(auth, registrarOrg, v.mobileNumber).mobileNumber,
      memberCount: v.memberCount,
      changeSource: v.changeSource,
      changedBy: v.changedByUser.fullName,
      createdAt: v.createdAt,
    })),
    /** Review decisions touching this household, for the append-only history timeline (UC-23). */
    reviews: {
      conflicts: conflicts.map((c) => ({
        conflictId: c.conflictId,
        fieldName: c.fieldName,
        status: c.status,
        localValue: maskConflictValue(c.fieldName, c.localValue),
        serverValue: maskConflictValue(c.fieldName, c.serverValue),
        resolvedValue: maskConflictValue(c.fieldName, c.resolvedValue),
        raisedAt: c.event.receivedAt,
        raisedBy: c.localUser.fullName,
        resolvedAt: c.resolvedAt,
        resolvedBy: c.resolvedByUser?.fullName ?? null,
      })),
      duplicatePairs: pairs.map((p) => ({
        pairId: p.pairId,
        otherShortCode: p.householdAId === h.householdId ? p.householdB.shortCode : p.householdA.shortCode,
        score: p.score.toFixed(2),
        label: p.label,
        status: p.status,
        reviewedAt: p.reviewedAt,
        reviewedBy: p.reviewedByUser?.fullName ?? null,
      })),
      flags: flags.map((f) => ({ flagId: f.flagId, status: f.status, note: f.note, createdAt: f.createdAt, reviewedAt: f.reviewedAt, reviewedBy: f.reviewedByUser?.fullName ?? null })),
    },
    distributions: distributions.map((d) => ({
      distributionId: d.distributionId,
      distributedAt: d.distributedAt,
      status: d.status,
      cancelReason: d.cancelReason,
      recordedBy: d.recordedByUser.fullName,
      organisation: d.recordedByUser.organisation?.name ?? null,
      items: d.items.map((i) => ({ itemId: i.itemId, itemName: i.item.itemName, unit: i.item.unit, quantity: i.quantity })),
    })),
  });
});

const patchSchema = z.object({
  baseVersion: z.number().int().min(1),
  changes: z
    .object({ headName: headName.optional(), mobileNumber: optionalMobile.optional(), memberCount: memberCount.optional() })
    .strict()
    .refine((c) => Object.keys(c).length > 0, "No changes supplied."),
});

/**
 * Online edit by a Group Coordinator of the registering organisation. Uses strict optimistic
 * concurrency (409 on a stale base_version) — field-level auto-merge is reserved for offline sync.
 */
export const PATCH = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "household.edit");
  const body = await parseJson(req, patchSchema);
  const h = await load(params.shortCode);
  assertOrgScope(auth, h.registeredByUser.organisationId);
  assertOperationActive(await getOperation(h.area.operationId));
  if (body.baseVersion !== h.version) {
    throw conflict("This household was changed by someone else. Reload and try again.", { currentVersion: h.version });
  }
  const merge = await prisma.$transaction((tx) =>
    mergeHouseholdChanges(tx, {
      householdId: h.householdId,
      baseVersion: body.baseVersion,
      changes: body.changes,
      actor: { userId: auth.userId, organisationId: auth.organisationId, deviceId: null },
      source: "FIELD_EDIT",
    }),
  );
  if (merge.conflicts.length > 0) {
    throw conflict("This household was changed concurrently. Reload and try again.");
  }
  if (Object.keys(merge.applied).length > 0) {
    await scoreHouseholds({ operationId: h.area.operationId, unionName: h.area.unionName, householdIds: [h.householdId] }).catch((e) =>
      console.error("[households] duplicate scoring failed", e),
    );
  }
  const updated = await load(params.shortCode);
  return ok({ household: { ...serializeHousehold(auth, updated), area: updated.area }, applied: Object.keys(merge.applied) });
});
