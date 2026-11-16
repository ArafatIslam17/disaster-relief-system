import { z } from "zod";
import { ok, parseJson, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";
import { purgeExpiredPii } from "@/lib/purge";

const schema = z.object({ dryRun: z.boolean().default(true) });

/** NFR07: 90-day closed-operation PII purge. Defaults to a dry run; pass {"dryRun": false} to execute. */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "pii.purge");
  const { dryRun } = await parseJson(req, schema);
  return ok(await purgeExpiredPii(auth.userId, { dryRun }));
});
