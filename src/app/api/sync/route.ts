import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { ApiError, forbidden } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { assertApprovedMembership, assertOperationActive, getOperation } from "@/lib/operations";
import { syncRequestSchema } from "@/lib/sync/schemas";
import { processBatch } from "@/lib/sync/engine";
import { buildDelta } from "@/lib/sync/delta";

/**
 * UC-16 / Sequence Diagram 03: upload an outbox batch, then download the delta.
 * Hard gates (403): closed operation, inactive account (enforced by authenticate), revoked or
 * foreign device, organisation not an approved member of the operation.
 */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "sync");
  const body = await parseJson(req, syncRequestSchema);

  if (auth.deviceId && auth.deviceId !== body.deviceId) throw forbidden("deviceId does not match the device this session signed in with.");
  const device = await prisma.device.findUnique({ where: { deviceId: body.deviceId } });
  if (!device || device.userId !== auth.userId) throw forbidden("Device is not registered to this account. Sign in from this device first.");
  if (device.status === "Revoked") throw new ApiError("DEVICE_REVOKED", "This device has been revoked. Contact your coordinator.");

  const operation = await getOperation(body.operationId);
  assertOperationActive(operation);
  await assertApprovedMembership(operation.operationId, auth.organisationId);

  const batch = await processBatch(
    { userId: auth.userId, organisationId: auth.organisationId!, deviceId: device.deviceId, operation },
    body.events,
  );
  const delta = await buildDelta(auth, operation.operationId, body.areaIds, body.since ?? null);
  await prisma.device.update({ where: { deviceId: device.deviceId }, data: { lastSyncAt: new Date() } });

  return ok({ ...batch, delta }, { headers: { "Cache-Control": "no-store" } });
});
