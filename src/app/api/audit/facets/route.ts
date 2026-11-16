import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ok, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";

/** Filter options for the audit trail, limited to what the caller may see (coordinators: own org). */
export const GET = route(async (req) => {
  const auth = await requirePermission(req, "audit.read");
  const where: Prisma.AuditLogWhereInput = auth.role === "GROUP_COORDINATOR" ? { organisationId: auth.organisationId } : {};
  const [actions, users, orgs, devices] = await Promise.all([
    prisma.auditLog.findMany({ where, distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
    prisma.auditLog.findMany({ where: { ...where, userId: { not: null } }, distinct: ["userId"], select: { user: { select: { userId: true, fullName: true } } } }),
    prisma.auditLog.findMany({ where: { ...where, organisationId: { not: null } }, distinct: ["organisationId"], select: { organisation: { select: { organisationId: true, name: true } } } }),
    prisma.auditLog.findMany({ where: { ...where, deviceId: { not: null } }, distinct: ["deviceId"], select: { device: { select: { deviceId: true, deviceLabel: true } } } }),
  ]);
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return ok({
    actions: actions.map((a) => a.action),
    users: users.flatMap((u) => (u.user ? [{ id: u.user.userId, name: u.user.fullName }] : [])).sort(byName),
    organisations: orgs.flatMap((o) => (o.organisation ? [{ id: o.organisation.organisationId, name: o.organisation.name }] : [])).sort(byName),
    devices: devices.flatMap((d) => (d.device ? [{ id: d.device.deviceId, name: d.device.deviceLabel }] : [])).sort(byName),
  });
});
