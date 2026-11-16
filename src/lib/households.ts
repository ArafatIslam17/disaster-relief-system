import "server-only";
import type { HouseholdChangeSource } from "@prisma/client";
import type { Tx } from "./audit";
import { writeAudit } from "./audit";
import { ApiError } from "./errors";

/** Fields captured in HOUSEHOLD_VERSION and subject to field-level conflict detection (FR16). */
export const VERSIONED_FIELDS = ["headName", "mobileNumber", "memberCount"] as const;
export type VersionedField = (typeof VERSIONED_FIELDS)[number];

export const FIELD_DB_NAME: Record<VersionedField, string> = {
  headName: "head_name",
  mobileNumber: "mobile_number",
  memberCount: "member_count",
};
export const DB_NAME_TO_FIELD: Record<string, VersionedField> = {
  head_name: "headName",
  mobile_number: "mobileNumber",
  member_count: "memberCount",
};

export type HouseholdValues = { headName: string; mobileNumber: string | null; memberCount: number };
export type HouseholdChanges = Partial<HouseholdValues>;

export function serializeField(field: VersionedField, value: HouseholdValues[VersionedField]): string | null {
  if (value === null || value === undefined) return null;
  return field === "memberCount" ? String(value) : String(value);
}

/** Row-locks the household for the rest of the transaction and returns its current state. */
export async function lockHousehold(tx: Tx, householdId: string) {
  const locked = await tx.$queryRaw<{ household_id: string }[]>`
    SELECT household_id FROM household WHERE household_id = ${householdId}::uuid FOR UPDATE`;
  if (locked.length === 0) return null;
  return tx.household.findUnique({
    where: { householdId },
    include: { area: { select: { operationId: true, unionName: true } }, registeredByUser: { select: { organisationId: true } } },
  });
}

/** Allocates the next FN-#### short code. Serialised with a transaction-scoped advisory lock. */
export async function nextShortCode(tx: Tx): Promise<string> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('household_short_code'))`;
  const rows = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX(CAST(substring(short_code FROM 4) AS INTEGER)) AS max
    FROM household WHERE short_code ~ '^FN-[0-9]+$'`;
  const next = (rows[0]?.max ?? 1000) + 1;
  return `FN-${String(next).padStart(4, "0")}`;
}

export type MergeResult = {
  applied: HouseholdChanges;
  conflicts: { field: VersionedField; localValue: string | null; serverValue: string | null }[];
  version: number;
};

/**
 * Field-level three-way merge (FR16, NFR11).
 *  - base_version == current.version → apply every changed field.
 *  - base_version <  current.version → for each incoming field, compare the value at base_version
 *    with the current server value. If the server did not touch the field since base, apply the
 *    incoming value (auto-merge). If it did and the values differ, keep the server value and report
 *    a same-field conflict.
 * Writes HOUSEHOLD + HOUSEHOLD_VERSION + AUDIT_LOG for applied changes. Conflict rows are created by
 * the caller because they reference the originating SYNC_EVENT.
 */
export async function mergeHouseholdChanges(
  tx: Tx,
  args: {
    householdId: string;
    baseVersion: number;
    changes: HouseholdChanges;
    actor: { userId: string; organisationId: string | null; deviceId: string | null };
    source: HouseholdChangeSource;
  },
): Promise<MergeResult> {
  const current = await lockHousehold(tx, args.householdId);
  if (!current) throw new ApiError("NOT_FOUND", "Household not found.");
  if (args.baseVersion > current.version || args.baseVersion < 1) {
    throw new ApiError("BAD_REQUEST", `base_version ${args.baseVersion} is invalid (server version is ${current.version}).`);
  }

  let base: HouseholdValues | null = current;
  if (args.baseVersion < current.version) {
    base = await tx.householdVersion.findUnique({
      where: { householdId_version: { householdId: args.householdId, version: args.baseVersion } },
      select: { headName: true, mobileNumber: true, memberCount: true },
    });
  }

  const applied: HouseholdChanges = {};
  const conflicts: MergeResult["conflicts"] = [];
  for (const field of VERSIONED_FIELDS) {
    if (!(field in args.changes)) continue;
    const incoming = args.changes[field] as HouseholdValues[typeof field];
    const serverValue = current[field];
    if (incoming === serverValue) continue;
    const serverChangedSinceBase = base === null ? true : base[field] !== serverValue;
    if (args.baseVersion === current.version || !serverChangedSinceBase) {
      (applied as Record<string, unknown>)[field] = incoming;
    } else {
      conflicts.push({ field, localValue: serializeField(field, incoming), serverValue: serializeField(field, serverValue) });
    }
  }

  let version = current.version;
  if (Object.keys(applied).length > 0) {
    version = await writeHouseholdVersion(tx, {
      household: current,
      values: { headName: current.headName, mobileNumber: current.mobileNumber, memberCount: current.memberCount, ...applied },
      actorUserId: args.actor.userId,
      source: args.source,
    });
    const oldValue: Record<string, unknown> = { version: current.version };
    for (const k of Object.keys(applied) as VersionedField[]) oldValue[k] = current[k];
    await writeAudit(tx, {
      userId: args.actor.userId,
      organisationId: args.actor.organisationId,
      deviceId: args.actor.deviceId,
      action: "HOUSEHOLD_UPDATED",
      entityType: "HOUSEHOLD",
      entityId: current.householdId,
      oldValue: oldValue as never,
      newValue: { ...applied, version } as never,
    });
  }
  return { applied, conflicts, version };
}

/** Increments household.version and appends the matching HOUSEHOLD_VERSION snapshot. */
export async function writeHouseholdVersion(
  tx: Tx,
  args: { household: { householdId: string; version: number }; values: HouseholdValues; actorUserId: string; source: HouseholdChangeSource },
): Promise<number> {
  const version = args.household.version + 1;
  await tx.household.update({
    where: { householdId: args.household.householdId },
    data: { headName: args.values.headName, mobileNumber: args.values.mobileNumber, memberCount: args.values.memberCount, version },
  });
  await tx.householdVersion.create({
    data: {
      householdId: args.household.householdId,
      version,
      headName: args.values.headName,
      mobileNumber: args.values.mobileNumber,
      memberCount: args.values.memberCount,
      changedBy: args.actorUserId,
      changeSource: args.source,
    },
  });
  return version;
}
