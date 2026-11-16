import "server-only";
import type { Tx } from "./audit";

/** Notification messages must not contain PII (names, phone numbers) — use short codes only. */
export type NotificationInput = { type: string; message: string; linkPath: string };

export async function notifyUsers(tx: Tx, userIds: Iterable<string>, n: NotificationInput) {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;
  const res = await tx.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
  return res.count;
}

export async function activeCoordinatorIds(tx: Tx, organisationIds: Iterable<string | null | undefined>) {
  const orgIds = [...new Set([...organisationIds].filter((x): x is string => !!x))];
  if (orgIds.length === 0) return [];
  const rows = await tx.user.findMany({
    where: { organisationId: { in: orgIds }, role: "GROUP_COORDINATOR", status: "Active" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

export async function activeRoleIds(tx: Tx, role: "OPERATION_ADMINISTRATOR" | "SYSTEM_ADMINISTRATOR") {
  const rows = await tx.user.findMany({ where: { role, status: "Active" }, select: { userId: true } });
  return rows.map((r) => r.userId);
}

/** Coordinators of the given orgs; falls back to System Administrators when an org has none. */
export async function coordinatorsOrSysAdmins(tx: Tx, organisationIds: Iterable<string | null | undefined>) {
  const ids = await activeCoordinatorIds(tx, organisationIds);
  return ids.length > 0 ? ids : activeRoleIds(tx, "SYSTEM_ADMINISTRATOR");
}
