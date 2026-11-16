import "server-only";
import { Prisma, type Operation } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { writeAudit, type Tx } from "../audit";
import { FIELD_DB_NAME, mergeHouseholdChanges, nextShortCode } from "../households";
import { activeCoordinatorIds, notifyUsers } from "../notify";
import { checkDistribution } from "../detection/distributions";
import { scoreHouseholds } from "../detection/duplicates";
import {
  distributionCreatePayload,
  distributionVoidPayload,
  eventEnvelopeSchema,
  householdCreatePayload,
  householdUpdatePayload,
  type EventEnvelope,
} from "./schemas";

export type SyncContext = {
  userId: string;
  organisationId: string;
  deviceId: string;
  operation: Operation;
};

export type ConflictSummary = { conflictId: string; householdId: string; fieldName: string };

export type EventResult =
  | { eventId: string; status: "applied"; entityId: string; shortCode?: string; conflicts?: ConflictSummary[]; mergedFields?: string[]; flagIds?: string[] }
  | { eventId: string; status: "duplicate"; entityId: string; shortCode?: string }
  | { eventId: string | null; status: "rejected"; code: string; message: string; retryable: boolean };

export type BatchResult = {
  acknowledgedIds: string[];
  rejected: Extract<EventResult, { status: "rejected" }>[];
  results: EventResult[];
  householdShortCodes: Record<string, string>;
  conflicts: ConflictSummary[];
  postSync: { duplicatePairsCreated: number; duplicatePairsUpdated: number; errors: string[] };
};

/** Non-retryable business-rule rejection for a single event. */
class Rejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const CLOCK_SKEW_MS = 10 * 60_000;

/**
 * Applies a batch of outbox events (Sequence Diagram 03). Each event runs in its own transaction
 * so one bad event never blocks the rest and an interrupted upload can resume: events already
 * stored in SYNC_EVENT are acknowledged without being re-applied (NFR09).
 */
export async function processBatch(ctx: SyncContext, rawEvents: unknown[]): Promise<BatchResult> {
  const out: BatchResult = {
    acknowledgedIds: [],
    rejected: [],
    results: [],
    householdShortCodes: {},
    conflicts: [],
    postSync: { duplicatePairsCreated: 0, duplicatePairsUpdated: 0, errors: [] },
  };
  const touchedByUnion = new Map<string, Set<string>>();

  for (const raw of rawEvents) {
    const parsed = eventEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      const eventId = typeof (raw as { eventId?: unknown })?.eventId === "string" ? (raw as { eventId: string }).eventId : null;
      pushResult(out, { eventId, status: "rejected", code: "INVALID_EVENT", message: issuesToMessage(parsed.error.issues), retryable: false });
      continue;
    }
    const ev = parsed.data;
    let result: EventResult;
    try {
      result = await prisma.$transaction((tx) => applyEvent(tx, ctx, ev, touchedByUnion), { timeout: 20_000, maxWait: 10_000 });
    } catch (err) {
      result = await classifyFailure(ctx, ev, err);
    }
    pushResult(out, result);
  }

  // Post-sync duplicate scoring (DuplicateDetector.scoreHouseholds) on touched unions.
  for (const [unionName, ids] of touchedByUnion) {
    try {
      const r = await scoreHouseholds({ operationId: ctx.operation.operationId, unionName, householdIds: [...ids] });
      out.postSync.duplicatePairsCreated += r.created;
      out.postSync.duplicatePairsUpdated += r.updated;
    } catch (err) {
      console.error("[sync] duplicate scoring failed", err);
      out.postSync.errors.push(`Duplicate scoring failed for ${unionName}; an administrator can re-run it from /api/duplicates/scan.`);
    }
  }
  return out;
}

function pushResult(out: BatchResult, r: EventResult) {
  out.results.push(r);
  if (r.status === "rejected") {
    out.rejected.push(r);
    return;
  }
  out.acknowledgedIds.push(r.eventId);
  if (r.shortCode) out.householdShortCodes[r.entityId] = r.shortCode;
  if (r.status === "applied" && r.conflicts) out.conflicts.push(...r.conflicts);
}

function issuesToMessage(issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((i) => (i.path.length ? `${i.path.map(String).join(".")}: ${i.message}` : i.message)).join("; ");
}

async function classifyFailure(ctx: SyncContext, ev: EventEnvelope, err: unknown): Promise<EventResult> {
  // A concurrent upload of the same event won the race: treat as already applied.
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = String((err.meta as { target?: unknown })?.target ?? "");
    if (target.includes("event_id") || target.includes("sync_event_pkey")) {
      const existing = await prisma.syncEvent.findUnique({ where: { eventId: ev.eventId } });
      if (existing && existing.deviceId === ctx.deviceId) return duplicateResult(ev);
    }
  }
  if (err instanceof Rejection) {
    await prisma.auditLog
      .create({
        data: {
          userId: ctx.userId,
          organisationId: ctx.organisationId,
          deviceId: ctx.deviceId,
          action: "SYNC_EVENT_REJECTED",
          entityType: ev.entityType,
          entityId: ev.entityId,
          newValue: { eventId: ev.eventId, action: ev.action, code: err.code },
        },
      })
      .catch((e) => console.error("[sync] failed to audit rejection", e));
    return { eventId: ev.eventId, status: "rejected", code: err.code, message: err.message, retryable: err.retryable };
  }
  console.error("[sync] event failed", ev.eventId, err);
  return { eventId: ev.eventId, status: "rejected", code: "SERVER_ERROR", message: "Temporary server error; retry later.", retryable: true };
}

async function duplicateResult(ev: EventEnvelope): Promise<EventResult> {
  let shortCode: string | undefined;
  if (ev.entityType === "HOUSEHOLD") {
    const h = await prisma.household.findUnique({ where: { householdId: ev.entityId }, select: { shortCode: true } });
    shortCode = h?.shortCode;
  }
  return { eventId: ev.eventId, status: "duplicate", entityId: ev.entityId, shortCode };
}

function parsePayload<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, payload: unknown): T {
  const r = schema.safeParse(payload);
  if (!r.success) throw new Rejection("INVALID_PAYLOAD", issuesToMessage(r.error.issues));
  return r.data;
}

async function applyEvent(tx: Tx, ctx: SyncContext, ev: EventEnvelope, touched: Map<string, Set<string>>): Promise<EventResult> {
  const existing = await tx.syncEvent.findUnique({ where: { eventId: ev.eventId }, select: { deviceId: true } });
  if (existing) {
    if (existing.deviceId !== ctx.deviceId) throw new Rejection("EVENT_ID_REUSED", "This event id was already used by another device.");
    let shortCode: string | undefined;
    if (ev.entityType === "HOUSEHOLD") {
      shortCode = (await tx.household.findUnique({ where: { householdId: ev.entityId }, select: { shortCode: true } }))?.shortCode;
    }
    return { eventId: ev.eventId, status: "duplicate", entityId: ev.entityId, shortCode };
  }
  if (ev.clientTime.getTime() > Date.now() + CLOCK_SKEW_MS) {
    throw new Rejection("CLOCK_SKEW", "Event time is in the future. Check the device date and time.");
  }

  // Record the event first: CONFLICT rows reference it. Rolled back with the transaction on rejection.
  await tx.syncEvent.create({
    data: {
      eventId: ev.eventId,
      deviceId: ctx.deviceId,
      entityType: ev.entityType,
      entityId: ev.entityId,
      action: ev.action,
      payload: ev.payload as Prisma.InputJsonValue,
      baseVersion: ev.baseVersion,
      clientTime: ev.clientTime,
    },
  });

  const kind = `${ev.entityType}:${ev.action}`;
  switch (kind) {
    case "HOUSEHOLD:CREATE":
      return householdCreate(tx, ctx, ev, touched);
    case "HOUSEHOLD:UPDATE":
      return householdUpdate(tx, ctx, ev, touched);
    case "DISTRIBUTION:CREATE":
      return distributionCreate(tx, ctx, ev);
    case "DISTRIBUTION:VOID":
      return distributionVoid(tx, ctx, ev);
    default:
      throw new Rejection("UNSUPPORTED_ACTION", `${ev.action} is not supported for ${ev.entityType}.`);
  }
}

async function areaInOperation(tx: Tx, ctx: SyncContext, areaId: string) {
  const area = await tx.area.findFirst({ where: { areaId, operationId: ctx.operation.operationId } });
  if (!area) throw new Rejection("AREA_NOT_IN_OPERATION", "Area does not belong to this operation.");
  return area;
}

function markTouched(touched: Map<string, Set<string>>, unionName: string, householdId: string) {
  if (!touched.has(unionName)) touched.set(unionName, new Set());
  touched.get(unionName)!.add(householdId);
}

async function householdCreate(tx: Tx, ctx: SyncContext, ev: EventEnvelope, touched: Map<string, Set<string>>): Promise<EventResult> {
  const p = parsePayload(householdCreatePayload, ev.payload);
  if (ev.baseVersion !== 0) throw new Rejection("INVALID_BASE_VERSION", "CREATE events must have base_version 0.");
  const area = await areaInOperation(tx, ctx, p.areaId);
  if (await tx.household.findUnique({ where: { householdId: ev.entityId }, select: { householdId: true } })) {
    throw new Rejection("ENTITY_EXISTS", "A household with this id already exists.");
  }
  if (p.consentAt.getTime() > Date.now() + CLOCK_SKEW_MS) throw new Rejection("CLOCK_SKEW", "Consent time is in the future.");

  const shortCode = await nextShortCode(tx);
  await tx.household.create({
    data: {
      householdId: ev.entityId,
      shortCode,
      areaId: area.areaId,
      registeredBy: ctx.userId,
      headName: p.headName,
      mobileNumber: p.mobileNumber,
      memberCount: p.memberCount,
      consentGiven: true,
      consentAt: p.consentAt,
      gpsLocation: p.gpsLocation,
      version: 1,
    },
  });
  await tx.householdVersion.create({
    data: { householdId: ev.entityId, version: 1, headName: p.headName, mobileNumber: p.mobileNumber, memberCount: p.memberCount, changedBy: ctx.userId, changeSource: "FIELD_EDIT" },
  });
  await writeAudit(tx, {
    userId: ctx.userId,
    organisationId: ctx.organisationId,
    deviceId: ctx.deviceId,
    action: "HOUSEHOLD_CREATED",
    entityType: "HOUSEHOLD",
    entityId: ev.entityId,
    newValue: { shortCode, headName: p.headName, mobileNumber: p.mobileNumber, memberCount: p.memberCount, version: 1, eventId: ev.eventId },
  });
  markTouched(touched, area.unionName, ev.entityId);
  return { eventId: ev.eventId, status: "applied", entityId: ev.entityId, shortCode };
}

async function householdUpdate(tx: Tx, ctx: SyncContext, ev: EventEnvelope, touched: Map<string, Set<string>>): Promise<EventResult> {
  const p = parsePayload(householdUpdatePayload, ev.payload);
  const h = await tx.household.findUnique({
    where: { householdId: ev.entityId },
    include: { area: true, registeredByUser: { select: { organisationId: true } } },
  });
  if (!h || h.area.operationId !== ctx.operation.operationId) throw new Rejection("NOT_FOUND", "Household not found in this operation.");
  if (h.registeredByUser.organisationId !== ctx.organisationId) {
    throw new Rejection("FORBIDDEN", "Only the registering organisation can edit this household.");
  }
  if (ev.baseVersion < 1 || ev.baseVersion > h.version) throw new Rejection("INVALID_BASE_VERSION", `base_version ${ev.baseVersion} is invalid.`);

  const merge = await mergeHouseholdChanges(tx, {
    householdId: h.householdId,
    baseVersion: ev.baseVersion,
    changes: p.changes,
    actor: { userId: ctx.userId, organisationId: ctx.organisationId, deviceId: ctx.deviceId },
    source: "FIELD_EDIT",
  });

  const conflicts: ConflictSummary[] = [];
  for (const c of merge.conflicts) {
    const fieldName = FIELD_DB_NAME[c.field];
    const row = await tx.conflict.create({
      data: {
        eventId: ev.eventId,
        householdId: h.householdId,
        fieldName,
        localValue: c.localValue,
        serverValue: c.serverValue,
        localUserId: ctx.userId,
        localDeviceId: ctx.deviceId,
        clientTime: ev.clientTime,
        status: "Open",
      },
    });
    conflicts.push({ conflictId: row.conflictId, householdId: h.householdId, fieldName });
    await writeAudit(tx, {
      userId: ctx.userId,
      organisationId: ctx.organisationId,
      deviceId: ctx.deviceId,
      action: "CONFLICT_RAISED",
      entityType: "CONFLICT",
      entityId: row.conflictId,
      newValue: { householdId: h.householdId, fieldName, localValue: c.localValue, serverValue: c.serverValue, baseVersion: ev.baseVersion },
    });
    const coordinators = await activeCoordinatorIds(tx, [h.registeredByUser.organisationId]);
    await notifyUsers(tx, coordinators, {
      type: "CONFLICT_OPEN",
      message: `Sync conflict on ${h.shortCode}: ${fieldName} was changed on the server and on a device.`,
      linkPath: `/conflicts/${row.conflictId}`,
    });
  }
  if (conflicts.length > 0) {
    await notifyUsers(tx, [ctx.userId], {
      type: "CONFLICT_OPEN",
      message: `Your offline edit to ${h.shortCode} conflicts with a server change and is awaiting coordinator review.`,
      linkPath: `/households/${h.shortCode}`,
    });
  }
  if (Object.keys(merge.applied).length > 0) markTouched(touched, h.area.unionName, h.householdId);

  return {
    eventId: ev.eventId,
    status: "applied",
    entityId: h.householdId,
    shortCode: h.shortCode,
    mergedFields: Object.keys(merge.applied).map((f) => FIELD_DB_NAME[f as keyof typeof FIELD_DB_NAME]),
    conflicts,
  };
}

async function distributionCreate(tx: Tx, ctx: SyncContext, ev: EventEnvelope): Promise<EventResult> {
  const p = parsePayload(distributionCreatePayload, ev.payload);
  if (ev.baseVersion !== 0) throw new Rejection("INVALID_BASE_VERSION", "CREATE events must have base_version 0.");
  await areaInOperation(tx, ctx, p.areaId);
  if (await tx.distribution.findUnique({ where: { distributionId: ev.entityId }, select: { distributionId: true } })) {
    throw new Rejection("ENTITY_EXISTS", "A distribution with this id already exists.");
  }
  if (p.householdId) {
    const h = await tx.household.findUnique({ where: { householdId: p.householdId }, select: { area: { select: { operationId: true } } } });
    // Retryable: the household's CREATE may still be queued on another device.
    if (!h) throw new Rejection("HOUSEHOLD_NOT_FOUND", "Household not found; it may not have synced yet.", true);
    if (h.area.operationId !== ctx.operation.operationId) throw new Rejection("HOUSEHOLD_NOT_IN_OPERATION", "Household belongs to another operation.");
  }
  const itemCount = await tx.reliefItem.count({ where: { operationId: ctx.operation.operationId, itemId: { in: p.items.map((i) => i.itemId) } } });
  if (itemCount !== p.items.length) throw new Rejection("ITEM_NOT_IN_OPERATION", "One or more relief items do not belong to this operation.");
  if (p.distributedAt.getTime() > Date.now() + CLOCK_SKEW_MS) throw new Rejection("CLOCK_SKEW", "Distribution time is in the future.");
  if (p.distributedAt < ctx.operation.startDate) throw new Rejection("BEFORE_OPERATION_START", "Distribution time is before the operation started.");

  await tx.distribution.create({
    data: {
      distributionId: ev.entityId,
      householdId: p.householdId,
      areaId: p.areaId,
      recordedBy: ctx.userId,
      distributedAt: p.distributedAt,
      isAnonymous: p.isAnonymous,
      status: "Active",
      items: { create: p.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })) },
    },
  });
  await writeAudit(tx, {
    userId: ctx.userId,
    organisationId: ctx.organisationId,
    deviceId: ctx.deviceId,
    action: "DISTRIBUTION_CREATED",
    entityType: "DISTRIBUTION",
    entityId: ev.entityId,
    newValue: { householdId: p.householdId, isAnonymous: p.isAnonymous, items: p.items, distributedAt: p.distributedAt.toISOString(), eventId: ev.eventId },
  });
  const flagIds = await checkDistribution(tx, ev.entityId);
  return { eventId: ev.eventId, status: "applied", entityId: ev.entityId, flagIds };
}

async function distributionVoid(tx: Tx, ctx: SyncContext, ev: EventEnvelope): Promise<EventResult> {
  const p = parsePayload(distributionVoidPayload, ev.payload);
  const locked = await tx.$queryRaw<{ distribution_id: string }[]>`
    SELECT distribution_id FROM distribution WHERE distribution_id = ${ev.entityId}::uuid FOR UPDATE`;
  const d = locked.length ? await tx.distribution.findUnique({ where: { distributionId: ev.entityId }, include: { area: { select: { operationId: true } } } }) : null;
  if (!d || d.area.operationId !== ctx.operation.operationId) throw new Rejection("NOT_FOUND", "Distribution not found in this operation.");
  if (d.recordedBy !== ctx.userId) throw new Rejection("FORBIDDEN", "Only the volunteer who recorded a distribution can void it.");
  if (d.status === "Voided") throw new Rejection("ALREADY_VOIDED", "This distribution is already voided.");
  if (ev.baseVersion !== d.version) throw new Rejection("VERSION_MISMATCH", `Distribution is at version ${d.version}, event was based on ${ev.baseVersion}.`);

  // UC-15 void window: measured from distributed_at to the moment the volunteer voided (client_time).
  const windowMs = env().VOID_WINDOW_HOURS * 3600_000;
  const elapsed = ev.clientTime.getTime() - d.distributedAt.getTime();
  if (elapsed > windowMs) throw new Rejection("VOID_WINDOW_EXPIRED", `Distributions can only be voided within ${env().VOID_WINDOW_HOURS} hours of being recorded.`);
  if (elapsed < -CLOCK_SKEW_MS) throw new Rejection("CLOCK_SKEW", "Void time is before the distribution time.");

  await tx.distribution.update({
    where: { distributionId: d.distributionId },
    data: { status: "Voided", cancelReason: p.cancelReason, version: d.version + 1 },
  });
  await writeAudit(tx, {
    userId: ctx.userId,
    organisationId: ctx.organisationId,
    deviceId: ctx.deviceId,
    action: "DISTRIBUTION_VOIDED",
    entityType: "DISTRIBUTION",
    entityId: d.distributionId,
    oldValue: { status: "Active", version: d.version },
    newValue: { status: "Voided", version: d.version + 1, cancelReason: p.cancelReason, eventId: ev.eventId },
  });
  return { eventId: ev.eventId, status: "applied", entityId: d.distributionId };
}
