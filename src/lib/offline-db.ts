import Dexie, { type Table } from "dexie";
import type { EncBlob } from "./offline-crypto";

/** Client-side outbox states — map 1:1 to the badge states in CLAUDE.md §2. */
export type OutboxState = "Pending" | "Uploading" | "Acknowledged" | "Failed" | "Rejected";

export type AuthSession = {
  id: "current";
  userId: string;
  fullName: string;
  /** The volunteer's own login number (not household PII); pre-fills re-authentication. */
  mobileNumber: string;
  role: string;
  organisationId: string | null;
  organisationName: string | null;
  deviceId: string;
  operationId: string;
  operationName: string;
  pinSalt: Uint8Array<ArrayBuffer>;
  pinVerifier: string;
  pinWrappedKey: EncBlob;
  pinExpiresAt: number;
  failedPinAttempts: number;
  lockedOut: boolean;
  passwordSalt: Uint8Array<ArrayBuffer>;
  passwordWrappedKey: EncBlob;
  createdAt: number;
};

export type MetaRow = { key: string; value: unknown };

export type LocalArea = {
  areaId: string;
  upazila: string;
  unionName: string;
  ward: string;
  /** 1 when the volunteer downloaded this ward's offline data pack. */
  downloaded: 0 | 1;
  downloadedAt: number | null;
};

export type LocalReliefItem = { itemId: string; itemName: string; unit: string };

/** Encrypted part of a household record. */
export type HouseholdPii = { headName: string; mobileNumber: string | null; gpsLocation: string | null };

export type LocalHousehold = {
  householdId: string;
  shortCode: string | null;
  provisionalCode: string | null;
  areaId: string;
  pii: EncBlob;
  mobileMasked: boolean;
  memberCount: number;
  /** Last server version known to the device; used as base_version for edits. */
  version: number;
  registeredBy: string;
  registeredByOrganisationId: string | null;
  ownOrganisation: boolean;
  consentAt: string;
  localUpdatedAt: number;
};

export type LocalDistribution = {
  distributionId: string;
  householdId: string | null;
  areaId: string;
  recordedBy: string;
  recordedByOrganisationId: string | null;
  distributedAt: string;
  isAnonymous: boolean;
  status: "Active" | "Voided";
  cancelReason: string | null;
  version: number;
  items: { itemId: string; quantity: number }[];
};

export type OutboxSummary = { kind: "register" | "edit" | "distribute" | "void"; householdId: string | null };

export type OutboxEvent = {
  eventId: string;
  seq: number;
  entityType: "HOUSEHOLD" | "DISTRIBUTION";
  entityId: string;
  action: "CREATE" | "UPDATE" | "VOID";
  baseVersion: number;
  clientTime: string;
  /** Encrypted event payload (contains PII for household events). */
  payload: EncBlob;
  state: OutboxState;
  attempts: number;
  lastError: { code: string; message: string } | null;
  nextAttemptAt: number;
  createdAt: number;
  acknowledgedAt: number | null;
  summary: OutboxSummary;
};

export type UnservedList = { releaseId: string; areaId: string; releasedAt: string; householdIds: string[] };

export type LocalNotification = { notificationId: string; type: string; message: string; linkPath: string; isRead: boolean; createdAt: string };

export class FieldDB extends Dexie {
  authSession!: Table<AuthSession, "current">;
  meta!: Table<MetaRow, string>;
  areas!: Table<LocalArea, string>;
  reliefItems!: Table<LocalReliefItem, string>;
  households!: Table<LocalHousehold, string>;
  distributions!: Table<LocalDistribution, string>;
  outboxEvents!: Table<OutboxEvent, string>;
  unservedLists!: Table<UnservedList, string>;
  notifications!: Table<LocalNotification, string>;

  constructor() {
    super("relief-field");
    this.version(1).stores({
      authSession: "id",
      meta: "key",
      areas: "areaId, unionName",
      reliefItems: "itemId",
      households: "householdId, shortCode, provisionalCode, areaId",
      distributions: "distributionId, householdId, areaId, recordedBy, distributedAt",
      outboxEvents: "eventId, seq, state, entityId",
      unservedLists: "releaseId, areaId",
      notifications: "notificationId, createdAt",
    });
  }
}

let instance: FieldDB | null = null;

/** Lazily constructed so server rendering never touches IndexedDB. */
export function fieldDb(): FieldDB {
  if (typeof window === "undefined") throw new Error("fieldDb() is browser-only");
  instance ??= new FieldDB();
  return instance;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await fieldDb().meta.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export function setMeta(key: string, value: unknown) {
  return fieldDb().meta.put({ key, value });
}

/** Stable per-install device id (DEVICE.device_id). Regenerated only when local data is wiped. */
export async function getDeviceId(): Promise<string> {
  const existing = await getMeta<string | null>("deviceId", null);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta("deviceId", id);
  return id;
}

export async function wipeLocalData() {
  const db = fieldDb();
  await db.transaction("rw", [db.authSession, db.meta, db.areas, db.reliefItems, db.households, db.distributions, db.outboxEvents, db.unservedLists, db.notifications], async () => {
    await Promise.all([db.authSession.clear(), db.meta.clear(), db.areas.clear(), db.reliefItems.clear(), db.households.clear(), db.distributions.clear(), db.outboxEvents.clear(), db.unservedLists.clear(), db.notifications.clear()]);
  });
}

export async function unsyncedCount(): Promise<number> {
  return fieldDb().outboxEvents.where("state").anyOf("Pending", "Uploading", "Failed", "Rejected").count();
}
