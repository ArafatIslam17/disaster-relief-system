import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { getOperation } from "@/lib/operations";
import { scoreHouseholds } from "@/lib/detection/duplicates";
import { uuid } from "@/lib/validation";

const schema = z.object({ operationId: uuid, unionName: z.string().trim().min(1).optional() });

/** Re-runs DuplicateDetector.scoreHouseholds across a whole union (or every union) of an operation. */
export const POST = route(async (req) => {
  await requirePermission(req, "duplicate.scan");
  const body = await parseJson(req, schema);
  const op = await getOperation(body.operationId);
  const unions = body.unionName
    ? [body.unionName]
    : (await prisma.area.findMany({ where: { operationId: op.operationId }, distinct: ["unionName"], select: { unionName: true } })).map((a) => a.unionName);
  const totals = { unions: unions.length, compared: 0, created: 0, updated: 0 };
  for (const unionName of unions) {
    const r = await scoreHouseholds({ operationId: op.operationId, unionName });
    totals.compared += r.compared;
    totals.created += r.created;
    totals.updated += r.updated;
  }
  return ok(totals);
});
