import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { ApiError, conflict, notFound } from "@/lib/errors";
import { assertOrgScope, requirePermission } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { DB_NAME_TO_FIELD, lockHousehold, writeHouseholdVersion, type HouseholdValues } from "@/lib/households";
import { assertOperationActive, getOperation } from "@/lib/operations";
import { headName, memberCount, optionalMobile, uuid } from "@/lib/validation";

type Params = { id: string };

const schema = z.object({
  /** server = keep server value, local = accept device value, custom = coordinator-entered value. */
  choice: z.enum(["server", "local", "custom"]),
  value: z.union([z.string(), z.number(), z.null()]).optional(),
});

function parseFieldValue(field: keyof HouseholdValues, raw: unknown): HouseholdValues[keyof HouseholdValues] {
  switch (field) {
    case "headName":
      return headName.parse(raw);
    case "mobileNumber":
      return optionalMobile.parse(raw ?? null);
    case "memberCount":
      return memberCount.parse(raw);
  }
}

/**
 * UC-17 / State Diagram 05: resolve an Open conflict. Always writes a new HOUSEHOLD_VERSION with
 * change_source CONFLICT_RESOLUTION (even when keeping the server value) so the decision itself is
 * in the append-only history.
 */
export const POST = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "conflict.review");
  const body = await parseJson(req, schema);
  const conflictId = uuid.parse(params.id);

  const c = await prisma.conflict.findUnique({
    where: { conflictId },
    include: { household: { include: { area: true, registeredByUser: { select: { organisationId: true } } } } },
  });
  if (!c) throw notFound("Conflict");
  assertOrgScope(auth, c.household.registeredByUser.organisationId);
  assertOperationActive(await getOperation(c.household.area.operationId));
  if (c.status !== "Open") throw conflict("Conflict is already resolved.");

  const field = DB_NAME_TO_FIELD[c.fieldName];
  if (!field) throw new ApiError("INTERNAL", `Unknown conflict field ${c.fieldName}.`);
  if (body.choice === "custom" && body.value === undefined) throw new ApiError("BAD_REQUEST", "Provide a value for a custom resolution.");

  const result = await prisma.$transaction(async (tx) => {
    const current = await lockHousehold(tx, c.householdId);
    if (!current) throw notFound("Household");
    const raw = body.choice === "server" ? current[field] : body.choice === "local" ? c.localValue : body.value;
    const value = parseFieldValue(field, raw);
    const resolvedValue = value === null ? "" : String(value);

    const claimed = await tx.conflict.updateMany({
      where: { conflictId, status: "Open" },
      data: { status: "Resolved", resolvedValue, resolvedBy: auth.userId, resolvedAt: new Date() },
    });
    if (claimed.count !== 1) throw conflict("Conflict was resolved by someone else.");

    const values: HouseholdValues = { headName: current.headName, mobileNumber: current.mobileNumber, memberCount: current.memberCount, [field]: value };
    const version = await writeHouseholdVersion(tx, { household: current, values, actorUserId: auth.userId, source: "CONFLICT_RESOLUTION" });

    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: c.household.registeredByUser.organisationId,
      action: "CONFLICT_RESOLVED",
      entityType: "CONFLICT",
      entityId: conflictId,
      oldValue: { status: "Open", localValue: c.localValue, serverValue: c.serverValue },
      newValue: { status: "Resolved", choice: body.choice, resolvedValue, householdVersion: version },
    });
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: c.household.registeredByUser.organisationId,
      action: "HOUSEHOLD_UPDATED",
      entityType: "HOUSEHOLD",
      entityId: c.householdId,
      oldValue: { [field]: current[field], version: current.version },
      newValue: { [field]: value, version, changeSource: "CONFLICT_RESOLUTION" },
    });
    await notifyUsers(tx, [c.localUserId].filter((id) => id !== auth.userId), {
      type: "CONFLICT_RESOLVED",
      message: `The ${c.fieldName} conflict on ${current.shortCode} was resolved.`,
      linkPath: "/field/records",
    });
    return { version, resolvedValue };
  });

  return ok({ conflictId, status: "Resolved", householdId: c.householdId, ...result });
});
