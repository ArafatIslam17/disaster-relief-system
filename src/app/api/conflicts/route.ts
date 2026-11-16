import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { householdScope } from "@/lib/scope";
import { maskMobile } from "@/lib/privacy";
import { uuid } from "@/lib/validation";

const query = z.object({ status: z.enum(["Open", "Resolved"]).default("Open"), operationId: uuid.optional() });

/** UC-17: conflict queue. Coordinators see conflicts on their own organisation's households. */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "conflict.review");
  const q = parseQuery(req, query);
  const rows = await prisma.conflict.findMany({
    where: { status: q.status, household: { ...householdScope(auth), ...(q.operationId ? { area: { operationId: q.operationId } } : {}) } },
    orderBy: [{ clientTime: "asc" }],
    include: {
      household: { select: { householdId: true, shortCode: true, version: true, area: true, registeredByUser: { select: { organisationId: true } } } },
      localUser: { select: { userId: true, fullName: true } },
      localDevice: { select: { deviceId: true, deviceLabel: true } },
      resolvedByUser: { select: { userId: true, fullName: true } },
      event: { select: { baseVersion: true, receivedAt: true } },
    },
  });
  return ok({
    conflicts: rows.map((c) => {
      const sameOrg = !!auth.organisationId && auth.organisationId === c.household.registeredByUser.organisationId;
      const mask = (v: string | null) => (c.fieldName === "mobile_number" && !sameOrg ? maskMobile(v) : v);
      return {
        conflictId: c.conflictId,
        status: c.status,
        fieldName: c.fieldName,
        localValue: mask(c.localValue),
        serverValue: mask(c.serverValue),
        resolvedValue: mask(c.resolvedValue),
        valuesMasked: c.fieldName === "mobile_number" && !sameOrg,
        clientTime: c.clientTime,
        receivedAt: c.event.receivedAt,
        baseVersion: c.event.baseVersion,
        household: { householdId: c.household.householdId, shortCode: c.household.shortCode, version: c.household.version, area: c.household.area },
        localUser: c.localUser,
        localDevice: c.localDevice,
        resolvedBy: c.resolvedByUser,
        resolvedAt: c.resolvedAt,
      };
    }),
  });
});
