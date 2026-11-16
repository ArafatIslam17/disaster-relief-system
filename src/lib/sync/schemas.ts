import { z } from "zod";
import { gpsLocation, headName, isoDateTime, memberCount, mobileNumber, uuid } from "../validation";

export const MAX_EVENTS_PER_BATCH = 200;

export const syncRequestSchema = z.object({
  operationId: uuid,
  deviceId: uuid,
  /** ISO timestamp from the previous response's `delta.nextSince`; omit/null for a full download. */
  since: isoDateTime.nullable().optional(),
  areaIds: z.array(uuid).max(500).default([]),
  events: z.array(z.unknown()).max(MAX_EVENTS_PER_BATCH).default([]),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

/** One OUTBOX_EVENT as queued in Dexie. `eventId` is the idempotency key (NFR09). */
export const eventEnvelopeSchema = z.object({
  eventId: uuid,
  entityType: z.enum(["HOUSEHOLD", "DISTRIBUTION"]),
  entityId: uuid,
  action: z.enum(["CREATE", "UPDATE", "VOID"]),
  payload: z.record(z.string(), z.unknown()),
  baseVersion: z.number().int().min(0),
  clientTime: isoDateTime,
});
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

const nullableMobile = z.union([mobileNumber, z.null()]);

export const householdCreatePayload = z.object({
  areaId: uuid,
  headName,
  mobileNumber: nullableMobile.optional().transform((v) => v ?? null),
  memberCount,
  consentGiven: z.literal(true, { message: "Household consent is required before registration." }),
  consentAt: isoDateTime,
  gpsLocation: gpsLocation.optional().transform((v) => v ?? null),
});

export const householdUpdatePayload = z.object({
  changes: z
    .object({ headName: headName.optional(), mobileNumber: nullableMobile.optional(), memberCount: memberCount.optional() })
    .strict()
    .refine((c) => Object.keys(c).length > 0, "No changes supplied."),
});

export const distributionCreatePayload = z
  .object({
    householdId: uuid.nullable(),
    areaId: uuid,
    isAnonymous: z.boolean(),
    distributedAt: isoDateTime,
    items: z.array(z.object({ itemId: uuid, quantity: z.number().int().min(1).max(1000) })).min(1).max(20),
  })
  .refine((d) => d.isAnonymous === (d.householdId === null), "Anonymous distributions must not reference a household, and identified ones must.")
  .refine((d) => new Set(d.items.map((i) => i.itemId)).size === d.items.length, "Each relief item may appear only once per distribution.");

export const distributionVoidPayload = z.object({
  cancelReason: z.string().trim().min(5, "Give a reason of at least 5 characters.").max(500),
});
