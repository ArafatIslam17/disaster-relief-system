import { z } from "zod";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { assertOrgScope, requirePermission, type AuthContext } from "@/lib/auth/guard";
import { COORDINATOR_ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { writeAudit } from "@/lib/audit";
import { notifyUsers } from "@/lib/notify";
import { uuid } from "@/lib/validation";

type Params = { id: string };
const ROLES = ["FIELD_VOLUNTEER", "GROUP_COORDINATOR", "OPERATION_ADMINISTRATOR", "SYSTEM_ADMINISTRATOR", "OBSERVER"] as const;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), role: z.enum(ROLES).optional() }),
  z.object({ action: z.literal("reject") }),
  z.object({ action: z.literal("assignRole"), role: z.enum(ROLES) }),
  z.object({ action: z.literal("deactivate") }),
  z.object({ action: z.literal("revokeDevice"), deviceId: uuid }),
]);

async function loadTarget(auth: AuthContext, id: string) {
  const target = await prisma.user.findUnique({ where: { userId: uuid.parse(id) }, include: { organisation: true, devices: true } });
  if (!target) throw notFound("User");
  assertOrgScope(auth, target.organisationId);
  return target;
}

function assertAssignable(auth: AuthContext, role: UserRole) {
  if (auth.role === "GROUP_COORDINATOR" && !COORDINATOR_ASSIGNABLE_ROLES.includes(role)) {
    throw forbidden("Coordinators can only assign Field Volunteer or Group Coordinator roles.");
  }
  if (["OPERATION_ADMINISTRATOR", "SYSTEM_ADMINISTRATOR", "OBSERVER"].includes(role) && auth.role !== "SYSTEM_ADMINISTRATOR") {
    throw forbidden();
  }
}

export const GET = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "member.read");
  const t = await loadTarget(auth, params.id);
  return ok({
    member: {
      userId: t.userId,
      fullName: t.fullName,
      mobileNumber: t.mobileNumber,
      role: t.role,
      status: t.status,
      failedAttempts: t.failedAttempts,
      lockedUntil: t.lockedUntil,
      mustChangePassword: t.mustChangePassword,
      createdAt: t.createdAt,
      organisation: t.organisation ? { organisationId: t.organisation.organisationId, name: t.organisation.name } : null,
      devices: t.devices.map((d) => ({ deviceId: d.deviceId, deviceLabel: d.deviceLabel, status: d.status, registeredAt: d.registeredAt, lastSyncAt: d.lastSyncAt })),
    },
  });
});

/** UC-05 / State Diagram 02: approve, reject, assign role, deactivate, revoke a lost device. */
export const PATCH = route<Params>(async (req, { params }) => {
  const auth = await requirePermission(req, "member.manage");
  const body = await parseJson(req, actionSchema);
  const target = await loadTarget(auth, params.id);
  if (target.userId === auth.userId && body.action !== "revokeDevice") throw forbidden("You cannot change your own account status or role.");
  if (auth.role === "GROUP_COORDINATOR" && !COORDINATOR_ASSIGNABLE_ROLES.includes(target.role)) throw forbidden();

  const base = { userId: auth.userId, organisationId: target.organisationId, entityType: "USER", entityId: target.userId };

  switch (body.action) {
    case "approve": {
      if (target.status !== "PendingApproval") throw conflict(`User is ${target.status}, not PendingApproval.`);
      if (target.organisation && target.organisation.status !== "Approved") throw conflict("The user's organisation has not been approved yet.");
      const role = body.role ?? target.role;
      assertAssignable(auth, role);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { userId: target.userId }, data: { status: "Active", role } });
        await writeAudit(tx, { ...base, action: "USER_APPROVED", oldValue: { status: target.status, role: target.role }, newValue: { status: "Active", role } });
        await notifyUsers(tx, [target.userId], { type: "ACCOUNT_APPROVED", message: "Your account has been approved. You can now sign in.", linkPath: "/login" });
      });
      return ok({ userId: target.userId, status: "Active", role });
    }
    case "reject": {
      if (target.status !== "PendingApproval") throw conflict(`User is ${target.status}, not PendingApproval.`);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { userId: target.userId }, data: { status: "Deactivated" } });
        await writeAudit(tx, { ...base, action: "USER_REJECTED", oldValue: { status: target.status }, newValue: { status: "Deactivated" } });
      });
      return ok({ userId: target.userId, status: "Deactivated" });
    }
    case "assignRole": {
      if (target.status === "Deactivated") throw conflict("Cannot change the role of a deactivated account.");
      assertAssignable(auth, body.role);
      if (body.role === target.role) return ok({ userId: target.userId, role: target.role });
      if (["FIELD_VOLUNTEER", "GROUP_COORDINATOR"].includes(body.role) && !target.organisationId) {
        throw conflict("Field roles require the user to belong to an organisation.");
      }
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { userId: target.userId }, data: { role: body.role } });
        await writeAudit(tx, { ...base, action: "ROLE_ASSIGNED", oldValue: { role: target.role }, newValue: { role: body.role } });
        await notifyUsers(tx, [target.userId], { type: "ROLE_CHANGED", message: `Your role was changed to ${body.role.replace(/_/g, " ").toLowerCase()}.`, linkPath: "/login" });
      });
      return ok({ userId: target.userId, role: body.role });
    }
    case "deactivate": {
      if (target.status === "Deactivated") throw conflict("User is already deactivated.");
      const active = target.devices.filter((d) => d.status === "Active");
      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { userId: target.userId }, data: { status: "Deactivated", lockedUntil: null } });
        await tx.device.updateMany({ where: { userId: target.userId, status: "Active" }, data: { status: "Revoked" } });
        await writeAudit(tx, { ...base, action: "USER_DEACTIVATED", oldValue: { status: target.status }, newValue: { status: "Deactivated", devicesRevoked: active.length } });
        for (const d of active) {
          await writeAudit(tx, { ...base, deviceId: d.deviceId, action: "DEVICE_REVOKED", entityType: "DEVICE", entityId: d.deviceId, oldValue: { status: "Active" }, newValue: { status: "Revoked", reason: "User deactivated" } });
        }
      });
      return ok({ userId: target.userId, status: "Deactivated", devicesRevoked: active.length });
    }
    case "revokeDevice": {
      const device = target.devices.find((d) => d.deviceId === body.deviceId);
      if (!device) throw notFound("Device");
      if (device.status === "Revoked") throw conflict("Device is already revoked.");
      await prisma.$transaction(async (tx) => {
        await tx.device.update({ where: { deviceId: device.deviceId }, data: { status: "Revoked" } });
        await writeAudit(tx, { ...base, deviceId: device.deviceId, action: "DEVICE_REVOKED", entityType: "DEVICE", entityId: device.deviceId, oldValue: { status: "Active" }, newValue: { status: "Revoked" } });
        await notifyUsers(tx, [target.userId], { type: "DEVICE_REVOKED", message: `Device "${device.deviceLabel}" was revoked and can no longer sync.`, linkPath: "/login" });
      });
      return ok({ deviceId: device.deviceId, status: "Revoked" });
    }
  }
});
