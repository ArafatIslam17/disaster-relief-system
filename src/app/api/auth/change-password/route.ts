import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseJson, route } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { authenticate } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { writeAudit } from "@/lib/audit";
import { password } from "@/lib/validation";

const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password });

/** Clears must_change_password after a temporary password (NFR03). */
export const POST = route(async (req) => {
  const auth = await authenticate(req, { allowPasswordChange: true });
  const body = await parseJson(req, schema);
  if (body.currentPassword === body.newPassword) throw new ApiError("BAD_REQUEST", "The new password must be different.");
  const user = await prisma.user.findUniqueOrThrow({ where: { userId: auth.userId } });
  if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
    throw new ApiError("UNAUTHENTICATED", "Current password is incorrect.");
  }
  const passwordHash = await hashPassword(body.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { userId: user.userId }, data: { passwordHash, mustChangePassword: false } });
    await writeAudit(tx, { userId: user.userId, organisationId: user.organisationId, deviceId: auth.deviceId, action: "PASSWORD_CHANGED", entityType: "USER", entityId: user.userId });
  });
  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, { sub: user.userId, role: user.role, org: user.organisationId, did: auth.deviceId, mcp: false });
  return res;
});
