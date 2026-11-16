import "server-only";
import { prisma } from "../db";
import type { AuthContext } from "../auth/guard";
import { householdSelect, serializeHousehold } from "../serializers";

/** Overlap so rows committed by transactions that started before `serverTime` are not missed. */
const SINCE_OVERLAP_MS = 60_000;

/**
 * Delta download: everything in the requested areas changed after `since`. Areas and relief items
 * are small reference sets and are always returned in full. Clients upsert by id and keep the
 * higher `version`, so the overlap window is harmless.
 */
export async function buildDelta(auth: AuthContext, operationId: string, requestedAreaIds: string[], since: Date | null | undefined) {
  const startedAt = Date.now();
  const [areas, reliefItems] = await Promise.all([
    prisma.area.findMany({ where: { operationId }, orderBy: [{ upazila: "asc" }, { unionName: "asc" }, { ward: "asc" }] }),
    prisma.reliefItem.findMany({ where: { operationId }, orderBy: { itemName: "asc" } }),
  ]);
  const opAreaIds = new Set(areas.map((a) => a.areaId));
  const areaIds = requestedAreaIds.filter((id) => opAreaIds.has(id));
  const ignoredAreaIds = requestedAreaIds.filter((id) => !opAreaIds.has(id));
  const changedSince = since ? { gt: since } : undefined;

  const [households, distributions, releases] = await Promise.all([
    prisma.household.findMany({
      where: { areaId: { in: areaIds }, updatedAt: changedSince },
      select: householdSelect,
      orderBy: { updatedAt: "asc" },
    }),
    prisma.distribution.findMany({
      where: { areaId: { in: areaIds }, updatedAt: changedSince },
      include: { items: true, recordedByUser: { select: { organisationId: true } } },
      orderBy: { updatedAt: "asc" },
    }),
    prisma.unservedRelease.findMany({
      where: { areaId: { in: areaIds }, releasedAt: changedSince },
      orderBy: { releasedAt: "asc" },
    }),
  ]);

  const releaseHouseholdIds = [...new Set(releases.flatMap((r) => r.householdIds))];
  const releaseHouseholds = releaseHouseholdIds.length
    ? await prisma.household.findMany({ where: { householdId: { in: releaseHouseholdIds } }, select: householdSelect })
    : [];
  const byId = new Map(releaseHouseholds.map((h) => [h.householdId, h]));

  return {
    serverTime: new Date(startedAt).toISOString(),
    nextSince: new Date(startedAt - SINCE_OVERLAP_MS).toISOString(),
    ignoredAreaIds,
    areas: areas.map((a) => ({ areaId: a.areaId, upazila: a.upazila, unionName: a.unionName, ward: a.ward })),
    reliefItems: reliefItems.map((i) => ({ itemId: i.itemId, itemName: i.itemName, unit: i.unit })),
    households: households.map((h) => serializeHousehold(auth, h)),
    distributions: distributions.map((d) => ({
      distributionId: d.distributionId,
      householdId: d.householdId,
      areaId: d.areaId,
      recordedBy: d.recordedBy,
      recordedByOrganisationId: d.recordedByUser.organisationId,
      distributedAt: d.distributedAt.toISOString(),
      isAnonymous: d.isAnonymous,
      status: d.status,
      cancelReason: d.cancelReason,
      version: d.version,
      items: d.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
      updatedAt: d.updatedAt.toISOString(),
    })),
    releasedUnservedLists: releases.map((r) => ({
      releaseId: r.releaseId,
      areaId: r.areaId,
      releasedAt: r.releasedAt.toISOString(),
      households: r.householdIds
        .map((id) => byId.get(id))
        .filter((h): h is NonNullable<typeof h> => !!h)
        .map((h) => serializeHousehold(auth, h)),
    })),
  };
}
