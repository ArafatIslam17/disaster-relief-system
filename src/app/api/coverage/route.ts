import { z } from "zod";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { computeCoverage } from "@/lib/coverage";
import { resolveOperation } from "@/lib/operations";
import { uuid } from "@/lib/validation";

const query = z.object({ operationId: uuid.optional() });

/** UC-20: served vs unserved per area. Aggregates only — safe for Observers. */
export const GET = route(async (req) => {
  await requirePermission(req, "coverage.read");
  const { operationId } = parseQuery(req, query);
  const op = await resolveOperation(operationId);
  const areas = await computeCoverage(op.operationId);
  const totals = areas.reduce(
    (t, a) => ({ registered: t.registered + a.registered, served: t.served + a.served, unserved: t.unserved + a.unserved, anonymousDistributions: t.anonymousDistributions + a.anonymousDistributions }),
    { registered: 0, served: 0, unserved: 0, anonymousDistributions: 0 },
  );
  return ok({ operation: { operationId: op.operationId, name: op.name, status: op.status }, areas, totals });
});
