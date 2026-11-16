import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { parseJson, route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { coordinatorsOrSysAdmins, notifyUsers } from "@/lib/notify";
import { mobileNumber, uuid } from "@/lib/validation";

const schema = z.object({
  mobileNumber,
  password: z.string().min(1).max(128),
  /** Client-generated device UUID persisted in IndexedDB. Required for offline sync; web sign-ins omit it (or send null). */
  deviceId: uuid.nullish(),
  deviceLabel: z.string().trim().min(1).max(100).nullish(),
});

const INVALID = () => new ApiError("UNAUTHENTICATED", "Mobile number or password is incorrect.");

/** UC-02: sign-in with lockout (NFR02) and device registration/validation. */
export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const { AUTH_MAX_FAILED_ATTEMPTS: maxAttempts, AUTH_LOCKOUT_MINUTES: lockMinutes } = env();
  const now = new Date();

  let user = await prisma.user.findUnique({ where: { mobileNumber: body.mobileNumber }, include: { organisation: true } });
  if (!user) {
    await verifyPassword(body.password, null);
    throw INVALID();
  }

  if (user.status === "Locked") {
    if (user.lockedUntil && user.lockedUntil <= now) {
      user = await prisma.$transaction(async (tx) => {
        const u = await tx.user.update({ where: { userId: user!.userId }, data: { status: "Active", failedAttempts: 0, lockedUntil: null }, include: { organisation: true } });
        await writeAudit(tx, { userId: u.userId, organisationId: u.organisationId, action: "USER_AUTO_UNLOCKED", entityType: "USER", entityId: u.userId, oldValue: { status: "Locked" }, newValue: { status: "Active" } });
        return u;
      });
    } else {
      throw new ApiError("ACCOUNT_LOCKED", "This account is locked. Try again later or ask your coordinator for a temporary password.", {
        lockedUntil: user.lockedUntil?.toISOString() ?? null,
      });
    }
  }

  const valid = await verifyPassword(body.password, user.passwordHash);
  if (!valid) {
    const lockedNow = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({ where: { userId: user!.userId }, data: { failedAttempts: { increment: 1 } } });
      if (u.status === "Active" && u.failedAttempts >= maxAttempts) {
        const lockedUntil = new Date(now.getTime() + lockMinutes * 60_000);
        await tx.user.update({ where: { userId: u.userId }, data: { status: "Locked", lockedUntil } });
        await writeAudit(tx, { userId: u.userId, organisationId: u.organisationId, action: "USER_LOCKED", entityType: "USER", entityId: u.userId, oldValue: { status: "Active", failedAttempts: u.failedAttempts - 1 }, newValue: { status: "Locked", failedAttempts: u.failedAttempts, lockedUntil: lockedUntil.toISOString() } });
        await notifyUsers(tx, await coordinatorsOrSysAdmins(tx, [u.organisationId]), {
          type: "ACCOUNT_LOCKED",
          message: `An account was locked after ${maxAttempts} failed sign-in attempts.`,
          linkPath: "/dashboard/admin?tab=users",
        });
        return lockedUntil;
      }
      await writeAudit(tx, { userId: u.userId, organisationId: u.organisationId, action: "LOGIN_FAILED", entityType: "USER", entityId: u.userId, newValue: { failedAttempts: u.failedAttempts } });
      return null;
    });
    if (lockedNow) {
      throw new ApiError("ACCOUNT_LOCKED", `Too many failed attempts. The account is locked for ${lockMinutes} minutes.`, { lockedUntil: lockedNow.toISOString() });
    }
    throw INVALID();
  }

  if (user.status === "PendingApproval") throw new ApiError("ACCOUNT_PENDING", "Your account is awaiting approval.");
  if (user.status === "Deactivated") throw new ApiError("ACCOUNT_DEACTIVATED", "This account has been deactivated.");
  if (user.organisation && user.organisation.status !== "Approved") throw new ApiError("ACCOUNT_PENDING", "Your organisation has not been approved.");

  const signedIn = user;
  const device = await prisma.$transaction(async (tx) => {
    let dev: { deviceId: string; deviceLabel: string; status: string } | null = null;
    if (body.deviceId) {
      const existing = await tx.device.findUnique({ where: { deviceId: body.deviceId } });
      if (existing) {
        if (existing.userId !== signedIn.userId) throw new ApiError("FORBIDDEN", "This device is registered to another user.");
        if (existing.status === "Revoked") throw new ApiError("DEVICE_REVOKED", "This device has been revoked. Contact your coordinator.");
        dev = existing;
      } else {
        dev = await tx.device.create({
          data: { deviceId: body.deviceId, userId: signedIn.userId, deviceLabel: body.deviceLabel ?? "Unlabelled device", status: "Active" },
        });
        await writeAudit(tx, { userId: signedIn.userId, organisationId: signedIn.organisationId, deviceId: dev.deviceId, action: "DEVICE_REGISTERED", entityType: "DEVICE", entityId: dev.deviceId, newValue: { deviceLabel: dev.deviceLabel } });
      }
    }
    await tx.user.update({ where: { userId: signedIn.userId }, data: { failedAttempts: 0 } });
    await writeAudit(tx, { userId: signedIn.userId, organisationId: signedIn.organisationId, deviceId: dev?.deviceId ?? null, action: "LOGIN", entityType: "USER", entityId: signedIn.userId });
    return dev;
  });

  const res = NextResponse.json({
    user: {
      userId: signedIn.userId,
      fullName: signedIn.fullName,
      role: signedIn.role,
      organisationId: signedIn.organisationId,
      organisationName: signedIn.organisation?.name ?? null,
    },
    device: device ? { deviceId: device.deviceId, deviceLabel: device.deviceLabel } : null,
    mustChangePassword: signedIn.mustChangePassword,
  });
  await setSessionCookie(res, { sub: signedIn.userId, role: signedIn.role, org: signedIn.organisationId, did: device?.deviceId ?? null, mcp: signedIn.mustChangePassword });
  return res;
});
