import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict, forbidden, notFound } from "@/lib/errors";
import { assertOrgScope, requirePermission } from "@/lib/auth/guard";
import { COORDINATOR_ASSIGNABLE_ROLES } from "@/lib/auth/rbac";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { uuid } from "@/lib/validation";

const schema = z.object({ userId: uuid });

/**
 * UC-05 / NFR03 / State Diagram 02: a Group Coordinator (own organisation, field roles only) or a
 * System Administrator issues a one-time temporary password. Locked accounts are unlocked; the
 * user must change the password at next sign-in. The password is returned once and never stored.
 */
export const POST = route(async (req) => {
  const auth = await requirePermission(req, "password.reset");
  const { userId } = await parseJson(req, schema);
  if (userId === auth.userId) throw forbidden("Use change-password for your own account.");

  const target = await prisma.user.findUnique({ where: { userId } });
  if (!target) throw notFound("User");
  if (auth.role === "GROUP_COORDINATOR") {
    assertOrgScope(auth, target.organisationId);
    if (!COORDINATOR_ASSIGNABLE_ROLES.includes(target.role)) throw forbidden("Coordinators can only reset field accounts.");
  }
  if (target.status !== "Active" && target.status !== "Locked") {
    throw conflict(`Cannot issue a temporary password to an account that is ${target.status}.`);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const wasLocked = target.status === "Locked";

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { userId },
      data: { passwordHash, mustChangePassword: true, status: "Active", failedAttempts: 0, lockedUntil: null },
    });
    await writeAudit(tx, {
      userId: auth.userId,
      organisationId: target.organisationId,
      action: "TEMP_PASSWORD_ISSUED",
      entityType: "USER",
      entityId: userId,
      oldValue: { status: target.status, failedAttempts: target.failedAttempts },
      newValue: { status: "Active", failedAttempts: 0, mustChangePassword: true },
    });
    if (wasLocked) {
      await writeAudit(tx, { userId: auth.userId, organisationId: target.organisationId, action: "USER_UNLOCKED", entityType: "USER", entityId: userId, oldValue: { status: "Locked" }, newValue: { status: "Active" } });
    }
  });

  return ok({ userId, temporaryPassword, unlocked: wasLocked, mustChangePassword: true }, { headers: { "Cache-Control": "no-store" } });
});
