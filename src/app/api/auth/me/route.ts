import { prisma } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { authenticate } from "@/lib/auth/guard";
import { PERMISSIONS, can, type Permission } from "@/lib/auth/rbac";

export const GET = route(async (req) => {
  const auth = await authenticate(req, { allowPasswordChange: true });
  const user = await prisma.user.findUniqueOrThrow({
    where: { userId: auth.userId },
    select: { userId: true, fullName: true, mobileNumber: true, role: true, status: true, organisation: { select: { organisationId: true, name: true } } },
  });
  const device = auth.deviceId
    ? await prisma.device.findUnique({ where: { deviceId: auth.deviceId }, select: { deviceId: true, deviceLabel: true, status: true, lastSyncAt: true } })
    : null;
  const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(auth.role, p));
  return ok({ user, device, mustChangePassword: auth.mustChangePassword, permissions });
});
