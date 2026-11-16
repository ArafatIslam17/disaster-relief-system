import { decryptJson, encryptJson } from "../offline-crypto";
import {
  fieldDb,
  type HouseholdPii,
  type LocalArea,
  type LocalDistribution,
  type LocalHousehold,
  type OutboxEvent,
  type OutboxSummary,
} from "../offline-db";
import { currentKey } from "./vault";

export type DecryptedHousehold = Omit<LocalHousehold, "pii"> & HouseholdPii;

export async function decryptHousehold(h: LocalHousehold): Promise<DecryptedHousehold> {
  const { pii, ...rest } = h;
  return { ...rest, ...(await decryptJson<HouseholdPii>(currentKey(), pii)) };
}

/** Display code: the server FN-#### once acknowledged, otherwise the device's temporary code. */
export function displayCode(h: Pick<LocalHousehold, "shortCode" | "provisionalCode">): string {
  return h.shortCode ?? h.provisionalCode ?? "—";
}

let seqCounter = 0;
function nextSeq() {
  seqCounter = (seqCounter + 1) % 1000;
  return Date.now() * 1000 + seqCounter;
}

async function enqueue(e: {
  entityType: OutboxEvent["entityType"];
  entityId: string;
  action: OutboxEvent["action"];
  baseVersion: number;
  payload: unknown;
  summary: OutboxSummary;
  clientTime?: string;
}) {
  const now = Date.now();
  const row: OutboxEvent = {
    eventId: crypto.randomUUID(),
    seq: nextSeq(),
    entityType: e.entityType,
    entityId: e.entityId,
    action: e.action,
    baseVersion: e.baseVersion,
    clientTime: e.clientTime ?? new Date(now).toISOString(),
    payload: await encryptJson(currentKey(), e.payload),
    state: "Pending",
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    createdAt: now,
    acknowledgedAt: null,
    summary: e.summary,
  };
  await fieldDb().outboxEvents.add(row);
  return row;
}

/** Temporary slip code, unique on this device, replaced by the server's FN-#### on sync. */
async function provisionalCode(): Promise<string> {
  const db = fieldDb();
  for (;;) {
    const code = `TMP-${String(1000 + Math.floor(Math.random() * 9000))}`;
    if ((await db.households.where("provisionalCode").equals(code).count()) === 0) return code;
  }
}

export type SessionLike = { userId: string; organisationId: string | null };

export async function registerHousehold(
  s: SessionLike,
  input: { areaId: string; headName: string; mobileNumber: string | null; memberCount: number; gpsLocation: string | null; consentAt: string },
) {
  const db = fieldDb();
  const householdId = crypto.randomUUID();
  const code = await provisionalCode();
  const pii: HouseholdPii = { headName: input.headName, mobileNumber: input.mobileNumber, gpsLocation: input.gpsLocation };
  const record: LocalHousehold = {
    householdId,
    shortCode: null,
    provisionalCode: code,
    areaId: input.areaId,
    pii: await encryptJson(currentKey(), pii),
    mobileMasked: false,
    memberCount: input.memberCount,
    version: 1,
    registeredBy: s.userId,
    registeredByOrganisationId: s.organisationId,
    ownOrganisation: true,
    consentAt: input.consentAt,
    localUpdatedAt: Date.now(),
  };
  await db.households.add(record);
  await enqueue({
    entityType: "HOUSEHOLD",
    entityId: householdId,
    action: "CREATE",
    baseVersion: 0,
    payload: { ...input, consentGiven: true },
    summary: { kind: "register", householdId },
  });
  return { householdId, provisionalCode: code };
}

export async function recordDistribution(
  s: SessionLike,
  input: { householdId: string | null; areaId: string; items: { itemId: string; quantity: number }[] },
) {
  const distributionId = crypto.randomUUID();
  const distributedAt = new Date().toISOString();
  const d: LocalDistribution = {
    distributionId,
    householdId: input.householdId,
    areaId: input.areaId,
    recordedBy: s.userId,
    recordedByOrganisationId: s.organisationId,
    distributedAt,
    isAnonymous: input.householdId === null,
    status: "Active",
    cancelReason: null,
    version: 1,
    items: input.items,
  };
  await fieldDb().distributions.add(d);
  await enqueue({
    entityType: "DISTRIBUTION",
    entityId: distributionId,
    action: "CREATE",
    baseVersion: 0,
    clientTime: distributedAt,
    payload: { householdId: input.householdId, areaId: input.areaId, isAnonymous: d.isAnonymous, distributedAt, items: input.items },
    summary: { kind: "distribute", householdId: input.householdId },
  });
  return d;
}

export type HouseholdChanges = Partial<{ headName: string; mobileNumber: string | null; memberCount: number }>;

/**
 * Queues a versioned UPDATE. Edits are coalesced into a not-yet-uploaded CREATE or UPDATE for the
 * same household so several offline edits never conflict with each other on the server.
 */
export async function editHousehold(h: DecryptedHousehold, changes: HouseholdChanges) {
  const db = fieldDb();
  const key = currentKey();
  const diff: HouseholdChanges = {};
  if (changes.headName !== undefined && changes.headName !== h.headName) diff.headName = changes.headName;
  if (changes.mobileNumber !== undefined && changes.mobileNumber !== h.mobileNumber) diff.mobileNumber = changes.mobileNumber;
  if (changes.memberCount !== undefined && changes.memberCount !== h.memberCount) diff.memberCount = changes.memberCount;
  if (Object.keys(diff).length === 0) return false;

  const open = (await db.outboxEvents.where("entityId").equals(h.householdId).sortBy("seq")).filter(
    (e) => e.state === "Pending" || e.state === "Failed",
  );
  const create = open.find((e) => e.action === "CREATE");
  const update = open.find((e) => e.action === "UPDATE");
  if (create) {
    const p = await decryptJson<Record<string, unknown>>(key, create.payload);
    await db.outboxEvents.update(create.eventId, { payload: await encryptJson(key, { ...p, ...diff }) });
  } else if (update) {
    const p = await decryptJson<{ changes: HouseholdChanges }>(key, update.payload);
    await db.outboxEvents.update(update.eventId, { payload: await encryptJson(key, { changes: { ...p.changes, ...diff } }), clientTime: new Date().toISOString() });
  } else {
    await enqueue({ entityType: "HOUSEHOLD", entityId: h.householdId, action: "UPDATE", baseVersion: h.version, payload: { changes: diff }, summary: { kind: "edit", householdId: h.householdId } });
  }

  const pii: HouseholdPii = {
    headName: diff.headName ?? h.headName,
    mobileNumber: diff.mobileNumber !== undefined ? diff.mobileNumber : h.mobileNumber,
    gpsLocation: h.gpsLocation,
  };
  await db.households.update(h.householdId, {
    pii: await encryptJson(key, pii),
    memberCount: diff.memberCount ?? h.memberCount,
    mobileMasked: diff.mobileNumber !== undefined ? false : h.mobileMasked,
    localUpdatedAt: Date.now(),
  });
  return true;
}

export const VOID_WINDOW_MS = 24 * 3600_000;

export function canVoid(d: LocalDistribution, userId: string, now = Date.now()) {
  return d.status === "Active" && d.recordedBy === userId && now - new Date(d.distributedAt).getTime() <= VOID_WINDOW_MS;
}

export async function voidDistribution(d: LocalDistribution, userId: string, cancelReason: string) {
  if (!canVoid(d, userId)) throw new Error("This distribution can no longer be voided.");
  await fieldDb().distributions.update(d.distributionId, { status: "Voided", cancelReason });
  await enqueue({
    entityType: "DISTRIBUTION",
    entityId: d.distributionId,
    action: "VOID",
    baseVersion: d.version,
    payload: { cancelReason },
    summary: { kind: "void", householdId: d.householdId },
  });
}

// ---------------------------------------------------------------------------
// Delta application
// ---------------------------------------------------------------------------

export type ServerHousehold = {
  householdId: string;
  shortCode: string;
  areaId: string;
  headName: string;
  mobileNumber: string | null;
  mobileMasked: boolean;
  memberCount: number;
  consentAt: string;
  gpsLocation: string | null;
  version: number;
  registeredBy: string;
  registeredByOrganisationId: string | null;
  ownOrganisation: boolean;
};

export type ServerDelta = {
  serverTime: string;
  nextSince: string;
  areas: { areaId: string; upazila: string; unionName: string; ward: string }[];
  reliefItems: { itemId: string; itemName: string; unit: string }[];
  households: ServerHousehold[];
  distributions: (Omit<LocalDistribution, "items"> & { items: { itemId: string; quantity: number }[] })[];
  releasedUnservedLists: { releaseId: string; areaId: string; releasedAt: string; households: ServerHousehold[] }[];
};

/**
 * Applies a server delta. Records with unacknowledged local outbox events are left alone so a
 * later batch's pending edits are never visually reverted; they refresh on the next pull.
 */
export async function applyDelta(delta: ServerDelta) {
  const db = fieldDb();
  const key = currentKey();
  const pendingEntities = new Set(
    (await db.outboxEvents.where("state").anyOf("Pending", "Uploading", "Failed").toArray()).map((e) => e.entityId),
  );
  const existingAreas = new Map((await db.areas.toArray()).map((a) => [a.areaId, a]));
  const areas: LocalArea[] = delta.areas.map((a) => ({
    ...a,
    downloaded: existingAreas.get(a.areaId)?.downloaded ?? 0,
    downloadedAt: existingAreas.get(a.areaId)?.downloadedAt ?? null,
  }));

  const toHousehold = async (h: ServerHousehold): Promise<LocalHousehold> => {
    const prev = await db.households.get(h.householdId);
    return {
      householdId: h.householdId,
      shortCode: h.shortCode,
      provisionalCode: prev?.provisionalCode ?? null,
      areaId: h.areaId,
      pii: await encryptJson(key, { headName: h.headName, mobileNumber: h.mobileNumber, gpsLocation: h.gpsLocation } satisfies HouseholdPii),
      mobileMasked: h.mobileMasked,
      memberCount: h.memberCount,
      version: h.version,
      registeredBy: h.registeredBy,
      registeredByOrganisationId: h.registeredByOrganisationId,
      ownOrganisation: h.ownOrganisation,
      consentAt: h.consentAt,
      localUpdatedAt: Date.now(),
    };
  };
  const serverHouseholds = [...delta.households, ...delta.releasedUnservedLists.flatMap((r) => r.households)].filter(
    (h) => !pendingEntities.has(h.householdId),
  );
  const households = await Promise.all(serverHouseholds.map(toHousehold));
  const distributions = delta.distributions
    .filter((d) => !pendingEntities.has(d.distributionId))
    .map<LocalDistribution>((d) => ({
      distributionId: d.distributionId,
      householdId: d.householdId,
      areaId: d.areaId,
      recordedBy: d.recordedBy,
      recordedByOrganisationId: d.recordedByOrganisationId,
      distributedAt: d.distributedAt,
      isAnonymous: d.isAnonymous,
      status: d.status,
      cancelReason: d.cancelReason,
      version: d.version,
      items: d.items,
    }));

  await db.transaction("rw", [db.areas, db.reliefItems, db.households, db.distributions, db.unservedLists], async () => {
    await db.areas.bulkPut(areas);
    await db.reliefItems.clear();
    await db.reliefItems.bulkPut(delta.reliefItems);
    await db.households.bulkPut(households);
    await db.distributions.bulkPut(distributions);
    await db.unservedLists.bulkPut(
      delta.releasedUnservedLists.map((r) => ({ releaseId: r.releaseId, areaId: r.areaId, releasedAt: r.releasedAt, householdIds: r.households.map((h) => h.householdId) })),
    );
  });
}

/**
 * Discard an event the server rejected (non-retryable). Records that never reached the server are
 * removed locally, together with queued events that depend on them. For rejected UPDATE/VOID the
 * next sync re-downloads the server's copy.
 */
export async function discardRejectedEvent(eventId: string) {
  const db = fieldDb();
  const e = await db.outboxEvents.get(eventId);
  if (!e || e.state !== "Rejected") return;
  await db.transaction("rw", [db.outboxEvents, db.households, db.distributions, db.meta], async () => {
    await db.outboxEvents.delete(eventId);
    if (e.action === "CREATE" && e.entityType === "HOUSEHOLD") {
      const dependents = await db.distributions.where("householdId").equals(e.entityId).toArray();
      const ids = [e.entityId, ...dependents.map((d) => d.distributionId)];
      await db.outboxEvents.where("entityId").anyOf(ids).filter((x) => x.state !== "Acknowledged").delete();
      await db.distributions.bulkDelete(dependents.map((d) => d.distributionId));
      await db.households.delete(e.entityId);
    } else if (e.action === "CREATE" && e.entityType === "DISTRIBUTION") {
      await db.outboxEvents.where("entityId").equals(e.entityId).filter((x) => x.state !== "Acknowledged").delete();
      await db.distributions.delete(e.entityId);
    } else {
      await db.meta.put({ key: "nextSince", value: null });
    }
  });
}
