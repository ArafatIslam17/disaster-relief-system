import "server-only";
import type { NextRequest } from "next/server";
import type { UserRole } from "@prisma/client";
import { prisma } from "../db";
import { ApiError, forbidden } from "../errors";
import { SESSION_COOKIE, verifySession } from "./session";
import { can, type Permission } from "./rbac";

export type AuthContext = {
  userId: string;
  role: UserRole;
  organisationId: string | null;
  fullName: string;
  deviceId: string | null;
  mustChangePassword: boolean;
};

/**
 * Authenticates the request and re-validates the account against the database on every call,
 * so deactivation, locking and device revocation take effect immediately (not at token expiry).
 */
export async function authenticate(
  req: NextRequest,
  opts: { allowPasswordChange?: boolean } = {},
): Promise<AuthContext> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySession(token) : null;
  if (!claims) throw new ApiError("UNAUTHENTICATED", "Sign in required.");

  const user = await prisma.user.findUnique({
    where: { userId: claims.sub },
    select: { userId: true, role: true, organisationId: true, fullName: true, status: true, lockedUntil: true, mustChangePassword: true },
  });
  if (!user) throw new ApiError("UNAUTHENTICATED", "Account no longer exists.");
  if (user.status === "Deactivated") throw new ApiError("ACCOUNT_DEACTIVATED", "This account has been deactivated.");
  if (user.status === "PendingApproval") throw new ApiError("ACCOUNT_PENDING", "This account is awaiting approval.");
  if (user.status === "Locked") throw new ApiError("ACCOUNT_LOCKED", "This account is locked.", { lockedUntil: user.lockedUntil });

  if (claims.did) {
    const device = await prisma.device.findUnique({ where: { deviceId: claims.did }, select: { status: true, userId: true } });
    if (!device || device.userId !== user.userId) throw new ApiError("UNAUTHENTICATED", "Device binding is invalid. Sign in again.");
    if (device.status === "Revoked") throw new ApiError("DEVICE_REVOKED", "This device has been revoked. Contact your coordinator.");
  }

  if (user.mustChangePassword && !opts.allowPasswordChange) {
    throw new ApiError("PASSWORD_CHANGE_REQUIRED", "You must change your temporary password before continuing.");
  }

  return {
    userId: user.userId,
    role: user.role,
    organisationId: user.organisationId,
    fullName: user.fullName,
    deviceId: claims.did,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function requirePermission(req: NextRequest, permission: Permission): Promise<AuthContext> {
  const auth = await authenticate(req);
  if (!can(auth.role, permission)) throw forbidden();
  return auth;
}

/** Coordinators may only act on their own organisation; other permitted roles are unscoped. */
export function assertOrgScope(auth: AuthContext, organisationId: string | null | undefined) {
  if (auth.role === "GROUP_COORDINATOR" && (!organisationId || organisationId !== auth.organisationId)) {
    throw forbidden("Coordinators can only act on records belonging to their own organisation.");
  }
}
