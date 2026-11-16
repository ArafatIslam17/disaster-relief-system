import "server-only";
import { prisma } from "./db";
import { STATUS_LABELS } from "./i18n/dictionary";

export type CoverageStatus = "NoRecords" | "Unserved" | "Served";

export type CoverageRow = {
  areaId: string;
  upazila: string;
  unionName: string;
  ward: string;
  registered: number;
  served: number;
  unserved: number;
  anonymousDistributions: number;
  status: CoverageStatus;
  label: { en: string; bn: string };
  lastReleasedAt: string | null;
  lastDistributionAt: string | null;
};

/**
 * Per-area coverage (UC-20). A household is "served" when it has at least one Active (non-voided)
 * distribution. Areas with zero registered households report "No Records / কোনো তথ্য নেই".
 */
export async function computeCoverage(operationId: string): Promise<CoverageRow[]> {
  const [areas, served, anonymous, releases, lastDist] = await Promise.all([
    prisma.area.findMany({
      where: { operationId },
      orderBy: [{ upazila: "asc" }, { unionName: "asc" }, { ward: "asc" }],
      select: { areaId: true, upazila: true, unionName: true, ward: true, _count: { select: { households: true } } },
    }),
    prisma.household.groupBy({
      by: ["areaId"],
      where: { area: { operationId }, distributions: { some: { status: "Active" } } },
      _count: { _all: true },
    }),
    prisma.distribution.groupBy({
      by: ["areaId"],
      where: { area: { operationId }, isAnonymous: true, status: "Active" },
      _count: { _all: true },
    }),
    prisma.unservedRelease.groupBy({ by: ["areaId"], where: { operationId }, _max: { releasedAt: true } }),
    prisma.distribution.groupBy({ by: ["areaId"], where: { area: { operationId }, status: "Active" }, _max: { distributedAt: true } }),
  ]);
  const lastDistBy = new Map(lastDist.map((d) => [d.areaId, d._max.distributedAt]));
  const servedBy = new Map(served.map((s) => [s.areaId, s._count._all]));
  const anonBy = new Map(anonymous.map((a) => [a.areaId, a._count._all]));
  const releasedBy = new Map(releases.map((r) => [r.areaId, r._max.releasedAt]));

  return areas.map((a) => {
    const registered = a._count.households;
    const s = servedBy.get(a.areaId) ?? 0;
    const status: CoverageStatus = registered === 0 ? "NoRecords" : s < registered ? "Unserved" : "Served";
    return {
      areaId: a.areaId,
      upazila: a.upazila,
      unionName: a.unionName,
      ward: a.ward,
      registered,
      served: s,
      unserved: registered - s,
      anonymousDistributions: anonBy.get(a.areaId) ?? 0,
      status,
      label: { en: STATUS_LABELS[status].en, bn: STATUS_LABELS[status].bn },
      lastReleasedAt: releasedBy.get(a.areaId)?.toISOString() ?? null,
      lastDistributionAt: lastDistBy.get(a.areaId)?.toISOString() ?? null,
    };
  });
}

/** Most recent sync batch received from any field device for this operation's areas. */
export async function lastFieldSyncAt(operationId: string): Promise<string | null> {
  const row = await prisma.device.aggregate({
    where: { user: { organisation: { memberships: { some: { operationId, status: "Approved" } } } } },
    _max: { lastSyncAt: true },
  });
  return row._max.lastSyncAt?.toISOString() ?? null;
}
