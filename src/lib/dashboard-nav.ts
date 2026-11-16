import type { UserRole } from "@prisma/client";
import { can } from "./auth/rbac";
import type { DashKey } from "./i18n/dictionary";

export type DashSection = "coverage" | "conflicts" | "duplicates" | "households" | "operations" | "admin" | "audit" | "reports";

/** Which roles may open each dashboard section. Mirrors the API permission matrix (src/lib/auth/rbac.ts). */
export function canOpen(role: UserRole, section: DashSection): boolean {
  switch (section) {
    case "coverage":
      return can(role, "coverage.read");
    case "conflicts":
      return can(role, "conflict.review");
    case "duplicates":
      return can(role, "duplicate.review") || can(role, "flag.review");
    case "households":
      return can(role, "household.read") && role !== "FIELD_VOLUNTEER";
    case "operations":
      return can(role, "operation.manage");
    case "admin":
      return can(role, "member.manage") || can(role, "organisation.review") || can(role, "operation.manage");
    case "audit":
      return can(role, "audit.read");
    case "reports":
      return can(role, "report.organisation") || can(role, "report.summary");
  }
}

export const NAV: { section: DashSection; href: string; label: DashKey }[] = [
  { section: "coverage", href: "/dashboard/coverage", label: "navCoverage" },
  { section: "conflicts", href: "/dashboard/conflicts", label: "navConflicts" },
  { section: "duplicates", href: "/dashboard/duplicates", label: "navDuplicates" },
  { section: "households", href: "/dashboard/households", label: "navHouseholds" },
  { section: "operations", href: "/dashboard/operations", label: "navOperations" },
  { section: "admin", href: "/dashboard/admin", label: "navAdmin" },
  { section: "audit", href: "/dashboard/audit", label: "navAudit" },
  { section: "reports", href: "/dashboard/reports", label: "navReports" },
];
