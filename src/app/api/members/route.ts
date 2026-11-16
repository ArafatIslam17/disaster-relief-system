import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseJson, parseQuery, route } from "@/lib/api";
import { ApiError, conflict } from "@/lib/errors";
import { requirePermission } from "@/lib/auth/guard";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { fullName, mobileNumber, uuid } from "@/lib/validation";

const ROLES = ["FIELD_VOLUNTEER", "GROUP_COORDINATOR", "OPERATION_ADMINISTRATOR", "SYSTEM_ADMINISTRATOR", "OBSERVER"] as const;
const STATUSES = ["PendingApproval", "Active", "Locked", "Deactivated"] as const;

const query = z.object({
  status: z.enum(STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  organisationId: uuid.optional(),
});

/** UC-05: member list. Coordinators see their own organisation only. */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "member.read");
  const q = parseQuery(req, query);
  const where: Prisma.UserWhereInput = {
    status: q.status,
    role: q.role,
    organisationId: auth.role === "GROUP_COORDINATOR" ? auth.organisationId : q.organisationId,
  };
  const users = await prisma.user.findMany({
    where,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    select: {
      userId: true,
      fullName: true,
      mobileNumber: true,
      role: true,
      status: true,
      failedAttempts: true,
      lockedUntil: true,
      mustChangePassword: true,
      createdAt: true,
      organisation: { select: { organisationId: true, name: true } },
      devices: { select: { deviceId: true, deviceLabel: true, status: true, registeredAt: true, lastSyncAt: true }, orderBy: { registeredAt: "asc" } },
    },
  });
  return ok({ members: users });
});

const createSchema = z
  .object({ fullName, mobileNumber, role: z.enum(ROLES), organisationId: uuid.nullable().default(null) })
  .refine((v) => !["FIELD_VOLUNTEER", "GROUP_COORDINATOR"].includes(v.role) || v.organisationId !== null, {
    message: "Field volunteers and coordinators must belong to an organisation.",
    path: ["organisationId"],
  });

/** System Administrator creates an account directly (e.g. Operation Administrators, Observers). */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "member.create");
  const body = await parseJson(req, createSchema);
  if (body.organisationId) {
    const org = await prisma.organisation.findUnique({ where: { organisationId: body.organisationId } });
    if (!org || org.status !== "Approved") throw new ApiError("BAD_REQUEST", "Organisation must exist and be approved.");
  }
  if (await prisma.user.findUnique({ where: { mobileNumber: body.mobileNumber }, select: { userId: true } })) {
    throw conflict("An account with this mobile number already exists.");
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { fullName: body.fullName, mobileNumber: body.mobileNumber, role: body.role, organisationId: body.organisationId, passwordHash, status: "Active", mustChangePassword: true },
    });
    await writeAudit(tx, { userId: auth.userId, organisationId: u.organisationId, action: "USER_CREATED", entityType: "USER", entityId: u.userId, newValue: { role: u.role, status: "Active", mustChangePassword: true } });
    return u;
  });
  return ok({ userId: user.userId, temporaryPassword, mustChangePassword: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
