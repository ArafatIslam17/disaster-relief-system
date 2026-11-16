import type { UserRole } from "@prisma/client";

const FV: UserRole = "FIELD_VOLUNTEER";
const GC: UserRole = "GROUP_COORDINATOR";
const OA: UserRole = "OPERATION_ADMINISTRATOR";
const SA: UserRole = "SYSTEM_ADMINISTRATOR";
const OB: UserRole = "OBSERVER";

/**
 * Permission matrix. Route handlers check permissions, never roles directly, so the matrix is the
 * single place to audit who can do what. Organisation scoping (coordinators act on their own
 * organisation only) is applied on top of this in each handler.
 */
export const PERMISSIONS = {
  "sync": [FV, GC],
  "household.read": [FV, GC, OA],
  "household.edit": [GC],
  "conflict.review": [GC, OA],
  "duplicate.review": [GC, OA],
  "duplicate.scan": [OA],
  "flag.review": [GC, OA],
  "coverage.read": [FV, GC, OA, SA, OB],
  "coverage.release": [GC, OA],
  "operation.read": [FV, GC, OA, SA, OB],
  "operation.manage": [OA],
  "membership.request": [GC],
  "organisation.review": [SA],
  "member.read": [GC, SA],
  "member.manage": [GC, SA],
  "member.create": [SA],
  "password.reset": [GC, SA],
  "audit.read": [GC, OA, SA],
  "report.organisation": [GC],
  "report.summary": [OA, OB],
  "pii.purge": [SA],
} as const satisfies Record<string, readonly UserRole[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: UserRole, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly UserRole[]).includes(role);
}

/** Roles a Group Coordinator may grant inside their own organisation. */
export const COORDINATOR_ASSIGNABLE_ROLES: readonly UserRole[] = [FV, GC];
