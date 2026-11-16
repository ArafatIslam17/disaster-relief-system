import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { ApiError, conflict, forbidden, notFound } from "@/lib/errors";
import { authenticate, type AuthContext } from "@/lib/auth/guard";
import { can } from "@/lib/auth/rbac";
import { writeAudit } from "@/lib/audit";
import { activeCoordinatorIds, activeRoleIds, notifyUsers } from "@/lib/notify";
import { assertOperationActive, getOperation } from "@/lib/operations";
import { parseCsv } from "@/lib/csv";
import { uuid } from "@/lib/validation";

type Params = { id: string };

const placeName = z.string().trim().min(2).max(60).transform((v) => v.replace(/\s+/g, " "));
const ward = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .transform((v) => (/^\d+$/.test(v) ? v.padStart(2, "0") : v.toUpperCase()));
const areaInput = z.object({ upazila: placeName, unionName: placeName, ward });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("addArea"), area: areaInput }),
  z.object({ action: z.literal("importAreasCsv"), csv: z.string().min(1).max(1_000_000) }),
  z.object({ action: z.literal("addItem"), itemName: z.string().trim().min(2).max(80), unit: z.string().trim().min(1).max(30) }),
  z.object({ action: z.literal("updateItem"), itemId: uuid, itemName: z.string().trim().min(2).max(80).optional(), unit: z.string().trim().min(1).max(30).optional() }),
  z.object({ action: z.literal("removeItem"), itemId: uuid }),
  z.object({ action: z.literal("requestMembership") }),
  z.object({ action: z.literal("reviewMembership"), organisationId: uuid, decision: z.enum(["approve", "reject"]) }),
]);

export const GET = route<Params>(async (req, { params }) => {
  const auth = await authenticate(req);
  if (!can(auth.role, "operation.read")) throw forbidden();
  const op = await getOperation(uuid.parse(params.id));
  const [areas, reliefItems, memberships] = await Promise.all([
    prisma.area.findMany({ where: { operationId: op.operationId }, orderBy: [{ upazila: "asc" }, { unionName: "asc" }, { ward: "asc" }] }),
    prisma.reliefItem.findMany({ where: { operationId: op.operationId }, include: { _count: { select: { distributionItems: true } } }, orderBy: { itemName: "asc" } }),
    can(auth.role, "operation.manage")
      ? prisma.operationMembership.findMany({ where: { operationId: op.operationId }, include: { organisation: { select: { name: true, orgType: true, status: true } } }, orderBy: { requestedAt: "asc" } })
      : prisma.operationMembership.findMany({ where: { operationId: op.operationId, organisationId: auth.organisationId ?? "00000000-0000-0000-0000-000000000000" }, include: { organisation: { select: { name: true, orgType: true, status: true } } } }),
  ]);
  return ok({
    operation: op,
    areas,
    reliefItems: reliefItems.map(({ _count, ...i }) => ({ ...i, inUse: _count.distributionItems > 0 })),
    memberships,
  });
});

/** UC-06/07/08: operation setup — areas (manual + CSV bulk), relief items, membership requests/reviews. */
export const POST = route<Params>(async (req, { params }) => {
  const auth = await authenticate(req);
  const op = await getOperation(uuid.parse(params.id));
  const body = await parseJson(req, actionSchema);
  assertOperationActive(op);

  const needManage = body.action !== "requestMembership";
  if (needManage && !can(auth.role, "operation.manage")) throw forbidden();
  if (!needManage && !can(auth.role, "membership.request")) throw forbidden();

  switch (body.action) {
    case "addArea":
      return addArea(auth, op.operationId, body.area);
    case "importAreasCsv":
      return importAreas(auth, op.operationId, body.csv);
    case "addItem":
      return addItem(auth, op.operationId, body.itemName, body.unit);
    case "updateItem":
      return updateItem(auth, op.operationId, body);
    case "removeItem":
      return removeItem(auth, op.operationId, body.itemId);
    case "requestMembership":
      return requestMembership(auth, op.operationId, op.name);
    case "reviewMembership":
      return reviewMembership(auth, op.operationId, op.name, body.organisationId, body.decision);
  }
});

const areaKey = (a: { upazila: string; unionName: string; ward: string }) => `${a.upazila.toLowerCase()}|${a.unionName.toLowerCase()}|${a.ward.toLowerCase()}`;

async function addArea(auth: AuthContext, operationId: string, area: z.infer<typeof areaInput>) {
  const existing = await prisma.area.findMany({ where: { operationId }, select: { upazila: true, unionName: true, ward: true } });
  if (existing.some((e) => areaKey(e) === areaKey(area))) throw conflict("This area already exists in the operation.");
  const created = await prisma.$transaction(async (tx) => {
    const a = await tx.area.create({ data: { operationId, ...area } });
    await writeAudit(tx, { userId: auth.userId, action: "AREA_CREATED", entityType: "AREA", entityId: a.areaId, newValue: area });
    return a;
  });
  return ok({ area: created }, { status: 201 });
}

async function importAreas(auth: AuthContext, operationId: string, csv: string) {
  const parsed = parseCsv(csv);
  const fields = parsed.meta.fields ?? [];
  const unionCol = fields.includes("union_name") ? "union_name" : fields.includes("union") ? "union" : null;
  if (!fields.includes("upazila") || !unionCol || !fields.includes("ward")) {
    throw new ApiError("BAD_REQUEST", "CSV header must contain: upazila, union_name, ward.");
  }
  if (parsed.data.length > 5000) throw new ApiError("BAD_REQUEST", "CSV may contain at most 5000 rows.");

  const existing = await prisma.area.findMany({ where: { operationId }, select: { upazila: true, unionName: true, ward: true } });
  const seen = new Set(existing.map(areaKey));
  const valid: z.infer<typeof areaInput>[] = [];
  const rejected: { row: number; reason: string }[] = [];

  parsed.data.forEach((r, idx) => {
    const row = idx + 2; // 1-based + header line
    const res = areaInput.safeParse({ upazila: r.upazila ?? "", unionName: r[unionCol] ?? "", ward: r.ward ?? "" });
    if (!res.success) {
      rejected.push({ row, reason: res.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
      return;
    }
    const key = areaKey(res.data);
    if (seen.has(key)) {
      rejected.push({ row, reason: "Duplicate area (already exists or repeated in file)." });
      return;
    }
    seen.add(key);
    valid.push(res.data);
  });
  for (const e of parsed.errors) rejected.push({ row: (e.row ?? 0) + 2, reason: `CSV parse error: ${e.message}` });

  if (valid.length > 0) {
    await prisma.$transaction(async (tx) => {
      await tx.area.createMany({ data: valid.map((v) => ({ operationId, ...v })) });
      await writeAudit(tx, { userId: auth.userId, action: "AREAS_IMPORTED", entityType: "OPERATION", entityId: operationId, newValue: { validCount: valid.length, rejectedCount: rejected.length } });
    });
  }
  rejected.sort((a, b) => a.row - b.row);
  return ok({ totalRows: parsed.data.length, validCount: valid.length, rejectedCount: rejected.length, rejected }, { status: valid.length > 0 ? 201 : 200 });
}

async function addItem(auth: AuthContext, operationId: string, itemName: string, unit: string) {
  const item = await prisma.$transaction(async (tx) => {
    const i = await tx.reliefItem.create({ data: { operationId, itemName, unit } });
    await writeAudit(tx, { userId: auth.userId, action: "RELIEF_ITEM_CREATED", entityType: "RELIEF_ITEM", entityId: i.itemId, newValue: { itemName, unit } });
    return i;
  });
  return ok({ item }, { status: 201 });
}

async function updateItem(auth: AuthContext, operationId: string, body: { itemId: string; itemName?: string; unit?: string }) {
  const item = await prisma.reliefItem.findFirst({ where: { itemId: body.itemId, operationId } });
  if (!item) throw notFound("Relief item");
  const data = { ...(body.itemName ? { itemName: body.itemName } : {}), ...(body.unit ? { unit: body.unit } : {}) };
  if (Object.keys(data).length === 0) throw new ApiError("BAD_REQUEST", "Nothing to update.");
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.reliefItem.update({ where: { itemId: item.itemId }, data });
    await writeAudit(tx, { userId: auth.userId, action: "RELIEF_ITEM_UPDATED", entityType: "RELIEF_ITEM", entityId: item.itemId, oldValue: { itemName: item.itemName, unit: item.unit }, newValue: data });
    return u;
  });
  return ok({ item: updated });
}

async function removeItem(auth: AuthContext, operationId: string, itemId: string) {
  const item = await prisma.reliefItem.findFirst({ where: { itemId, operationId }, include: { _count: { select: { distributionItems: true } } } });
  if (!item) throw notFound("Relief item");
  if (item._count.distributionItems > 0) throw conflict("This item has already been distributed and cannot be removed.");
  await prisma.$transaction(async (tx) => {
    await tx.reliefItem.delete({ where: { itemId } });
    await writeAudit(tx, { userId: auth.userId, action: "RELIEF_ITEM_REMOVED", entityType: "RELIEF_ITEM", entityId: itemId, oldValue: { itemName: item.itemName, unit: item.unit } });
  });
  return ok({ removed: itemId });
}

async function requestMembership(auth: AuthContext, operationId: string, operationName: string) {
  if (!auth.organisationId) throw forbidden("Your account is not attached to an organisation.");
  const org = await prisma.organisation.findUniqueOrThrow({ where: { organisationId: auth.organisationId } });
  if (org.status !== "Approved") throw forbidden("Your organisation must be approved first.");
  const key = { operationId_organisationId: { operationId, organisationId: org.organisationId } };
  const existing = await prisma.operationMembership.findUnique({ where: key });
  if (existing && existing.status !== "Rejected") throw conflict(`Membership is already ${existing.status}.`);

  const membership = await prisma.$transaction(async (tx) => {
    const m = existing
      ? await tx.operationMembership.update({ where: key, data: { status: "Pending", requestedAt: new Date(), reviewedAt: null } })
      : await tx.operationMembership.create({ data: { operationId, organisationId: org.organisationId, status: "Pending" } });
    await writeAudit(tx, { userId: auth.userId, organisationId: org.organisationId, action: "MEMBERSHIP_REQUESTED", entityType: "OPERATION_MEMBERSHIP", entityId: `${operationId}:${org.organisationId}`, newValue: { status: "Pending" } });
    await notifyUsers(tx, await activeRoleIds(tx, "OPERATION_ADMINISTRATOR"), {
      type: "MEMBERSHIP_PENDING",
      message: `${org.name} requested to join ${operationName}.`,
      linkPath: "/operation/memberships",
    });
    return m;
  });
  return ok({ membership }, { status: 201 });
}

async function reviewMembership(auth: AuthContext, operationId: string, operationName: string, organisationId: string, decision: "approve" | "reject") {
  const key = { operationId_organisationId: { operationId, organisationId } };
  const m = await prisma.operationMembership.findUnique({ where: key, include: { organisation: true } });
  if (!m) throw notFound("Membership request");
  if (m.status !== "Pending") throw conflict(`Membership is already ${m.status}.`);
  if (decision === "approve" && m.organisation.status !== "Approved") throw conflict("The organisation itself has not been approved yet.");
  const status = decision === "approve" ? "Approved" : "Rejected";
  const updated = await prisma.$transaction(async (tx) => {
    const res = await tx.operationMembership.updateMany({ where: { operationId, organisationId, status: "Pending" }, data: { status, reviewedAt: new Date() } });
    if (res.count !== 1) throw conflict("Membership was reviewed by someone else.");
    await writeAudit(tx, { userId: auth.userId, organisationId, action: decision === "approve" ? "MEMBERSHIP_APPROVED" : "MEMBERSHIP_REJECTED", entityType: "OPERATION_MEMBERSHIP", entityId: `${operationId}:${organisationId}`, oldValue: { status: "Pending" }, newValue: { status } });
    await notifyUsers(tx, await activeCoordinatorIds(tx, [organisationId]), {
      type: decision === "approve" ? "MEMBERSHIP_APPROVED" : "MEMBERSHIP_REJECTED",
      message: `Your request to join ${operationName} was ${status.toLowerCase()}.`,
      linkPath: "/operation",
    });
    return tx.operationMembership.findUniqueOrThrow({ where: key });
  });
  return ok({ membership: updated });
}
