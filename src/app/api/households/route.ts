import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { resolveOperation } from "@/lib/operations";
import { householdSelect, serializeHousehold } from "@/lib/serializers";
import { uuid } from "@/lib/validation";

const query = z.object({
  operationId: uuid.optional(),
  areaId: uuid.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Household search (short code or name). Phone numbers are masked across organisations (NFR06). */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "household.read");
  const qp = parseQuery(req, query);
  const op = await resolveOperation(qp.operationId);
  const where: Prisma.HouseholdWhereInput = {
    area: { operationId: op.operationId },
    ...(qp.areaId ? { areaId: qp.areaId } : {}),
    ...(qp.q ? { OR: [{ shortCode: { contains: qp.q, mode: "insensitive" } }, { headName: { contains: qp.q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.household.count({ where }),
    prisma.household.findMany({
      where,
      select: { ...householdSelect, area: { select: { upazila: true, unionName: true, ward: true } } },
      orderBy: { shortCode: "asc" },
      take: qp.limit,
      skip: qp.offset,
    }),
  ]);
  return ok({ operationId: op.operationId, total, households: rows.map((h) => ({ ...serializeHousehold(auth, h), area: h.area })) });
});
