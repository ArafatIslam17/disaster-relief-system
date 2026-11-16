import { decryptJson } from "../offline-crypto";
import { fieldDb, getMeta, setMeta, type LocalNotification, type OutboxEvent } from "../offline-db";
import { ApiFailure, fieldFetch, OfflineError } from "./api";
import { applyDelta, type ServerDelta } from "./repo";
import { currentKey, getSession } from "./vault";

export const BATCH_SIZE = 10;
const ACK_RETENTION_MS = 7 * 24 * 3600_000;

type SyncResponse = {
  acknowledgedIds: string[];
  rejected: { eventId: string | null; code: string; message: string; retryable: boolean }[];
  householdShortCodes: Record<string, string>;
  delta: ServerDelta;
};

export type SyncOutcome =
  | { status: "ok"; uploaded: number; rejected: number; failed: number }
  | { status: "offline" }
  | { status: "authRequired" }
  | { status: "blocked"; code: string; message: string }
  | { status: "error"; message: string };

/** Exponential backoff for retryable failures: 30 s, 1 m, 2 m … capped at 30 m. */
function backoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);
}

let running: Promise<SyncOutcome> | null = null;

/** Single-flight: concurrent callers share the in-progress run. */
export function runSync(opts: { force?: boolean } = {}): Promise<SyncOutcome> {
  running ??= doSync(opts).finally(() => {
    running = null;
  });
  return running;
}

async function downloadedAreaIds() {
  return (await fieldDb().areas.toArray()).filter((a) => a.downloaded === 1).map((a) => a.areaId);
}

/**
 * Sequence Diagram 03: upload the outbox in batches of 10, then apply the server delta.
 * Each event moves Pending → Uploading → Acknowledged | Failed (retryable) | Rejected.
 * A network drop mid-batch returns the batch to Pending; the server's event_id idempotency makes
 * the replay safe, so uploads resume exactly where they stopped.
 */
async function doSync({ force = false }: { force?: boolean }): Promise<SyncOutcome> {
  const db = fieldDb();
  const session = await getSession();
  if (!session) return { status: "error", message: "Not signed in" };

  // Events left Uploading by a killed tab were never confirmed: make them Pending again.
  await db.outboxEvents.where("state").equals("Uploading").modify({ state: "Pending" });

  const attempted = new Set<string>();
  let uploaded = 0;
  let rejected = 0;
  let failed = 0;
  let pulled = false;

  for (;;) {
    const now = Date.now();
    const batch = (await db.outboxEvents.orderBy("seq").toArray())
      .filter((e) => !attempted.has(e.eventId) && (e.state === "Pending" || (e.state === "Failed" && (force || e.nextAttemptAt <= now))))
      .slice(0, BATCH_SIZE);
    if (batch.length === 0 && pulled) break;

    const ids = batch.map((e) => e.eventId);
    ids.forEach((id) => attempted.add(id));
    await db.outboxEvents.where("eventId").anyOf(ids).modify({ state: "Uploading" });

    const key = currentKey();
    const events = await Promise.all(
      batch.map(async (e: OutboxEvent) => ({
        eventId: e.eventId,
        entityType: e.entityType,
        entityId: e.entityId,
        action: e.action,
        baseVersion: e.baseVersion,
        clientTime: e.clientTime,
        payload: await decryptJson<Record<string, unknown>>(key, e.payload),
      })),
    );

    let res: SyncResponse;
    try {
      res = await fieldFetch<SyncResponse>("/api/sync", {
        body: { operationId: session.operationId, deviceId: session.deviceId, since: await getMeta<string | null>("nextSince", null), areaIds: await downloadedAreaIds(), events },
        timeoutMs: 60_000,
      });
    } catch (err) {
      if (err instanceof ApiFailure && err.status >= 500) {
        await markFailed(ids, { code: err.code, message: err.message });
        await setMeta("lastSyncError", err.message);
        return { status: "error", message: err.message };
      }
      await db.outboxEvents.where("eventId").anyOf(ids).modify({ state: "Pending" });
      if (err instanceof OfflineError) return { status: "offline" };
      if (err instanceof ApiFailure && err.status === 401) return { status: "authRequired" };
      if (err instanceof ApiFailure && err.status === 403) {
        await setMeta("lastSyncError", err.message);
        return { status: "blocked", code: err.code, message: err.message };
      }
      const message = err instanceof Error ? err.message : "Sync failed";
      await setMeta("lastSyncError", message);
      return { status: "error", message };
    }

    const acked = new Set(res.acknowledgedIds);
    const now2 = Date.now();
    await db.transaction("rw", [db.outboxEvents, db.households], async () => {
      for (const e of batch) {
        if (acked.has(e.eventId)) {
          await db.outboxEvents.update(e.eventId, { state: "Acknowledged", acknowledgedAt: now2, lastError: null });
          continue;
        }
        const r = res.rejected.find((x) => x.eventId === e.eventId);
        if (!r) {
          await db.outboxEvents.update(e.eventId, { state: "Pending" });
          continue;
        }
        const attempts = e.attempts + 1;
        await db.outboxEvents.update(e.eventId, {
          state: r.retryable ? "Failed" : "Rejected",
          attempts,
          lastError: { code: r.code, message: r.message },
          nextAttemptAt: r.retryable ? now2 + backoffMs(attempts) : Number.MAX_SAFE_INTEGER,
        });
        if (r.retryable) failed++;
        else rejected++;
      }
      for (const [householdId, shortCode] of Object.entries(res.householdShortCodes)) {
        await db.households.update(householdId, { shortCode, localUpdatedAt: now2 });
      }
    });
    uploaded += res.acknowledgedIds.length;

    await applyDelta(res.delta);
    await setMeta("nextSince", res.delta.nextSince);
    await setMeta("lastSyncAt", now2);
    await setMeta("lastSyncError", null);
    pulled = true;
  }

  await db.outboxEvents.where("state").equals("Acknowledged").filter((e) => (e.acknowledgedAt ?? 0) < Date.now() - ACK_RETENTION_MS).delete();
  await refreshNotifications().catch(() => undefined);
  return { status: "ok", uploaded, rejected, failed };
}

async function markFailed(ids: string[], error: { code: string; message: string }) {
  const db = fieldDb();
  const now = Date.now();
  await db.transaction("rw", db.outboxEvents, async () => {
    for (const e of await db.outboxEvents.where("eventId").anyOf(ids).toArray()) {
      const attempts = e.attempts + 1;
      await db.outboxEvents.update(e.eventId, { state: "Failed", attempts, lastError: error, nextAttemptAt: now + backoffMs(attempts) });
    }
  });
}

/** UC-10: full pull of one ward's data pack (since = null), then mark it downloaded. */
export async function downloadArea(areaId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const res = await fieldFetch<SyncResponse>("/api/sync", {
    body: { operationId: session.operationId, deviceId: session.deviceId, since: null, areaIds: [areaId], events: [] },
    timeoutMs: 60_000,
  });
  await applyDelta(res.delta);
  await fieldDb().areas.update(areaId, { downloaded: 1, downloadedAt: Date.now() });
}

/** Removes a ward's data pack. Records still waiting in the outbox are kept. */
export async function removeArea(areaId: string) {
  const db = fieldDb();
  const pending = new Set((await db.outboxEvents.where("state").noneOf(["Acknowledged"]).toArray()).map((e) => e.entityId));
  await db.transaction("rw", [db.areas, db.households, db.distributions, db.unservedLists], async () => {
    await db.households.where("areaId").equals(areaId).filter((h) => !pending.has(h.householdId)).delete();
    await db.distributions.where("areaId").equals(areaId).filter((d) => !pending.has(d.distributionId)).delete();
    await db.unservedLists.where("areaId").equals(areaId).delete();
    await db.areas.update(areaId, { downloaded: 0, downloadedAt: null });
  });
}

/** Area list + relief items without downloading any household data. */
export async function pullReferenceData() {
  const session = await getSession();
  if (!session) throw new Error("Not signed in");
  const res = await fieldFetch<SyncResponse>("/api/sync", {
    body: { operationId: session.operationId, deviceId: session.deviceId, since: null, areaIds: [], events: [] },
  });
  await applyDelta(res.delta);
}

export async function refreshNotifications() {
  const res = await fieldFetch<{ notifications: LocalNotification[] }>("/api/notifications?limit=30");
  const db = fieldDb();
  await db.transaction("rw", db.notifications, async () => {
    await db.notifications.clear();
    await db.notifications.bulkPut(res.notifications.map((n) => ({ notificationId: n.notificationId, type: n.type, message: n.message, linkPath: n.linkPath, isRead: n.isRead, createdAt: n.createdAt })));
  });
}

export async function markNotificationsRead() {
  await fieldFetch("/api/notifications", { method: "PATCH", body: { all: true } });
  await fieldDb().notifications.toCollection().modify({ isRead: true });
}
