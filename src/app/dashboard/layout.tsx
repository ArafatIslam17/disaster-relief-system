import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { getPageSession } from "@/lib/auth/page-session";
import { PERMISSIONS, can, type Permission } from "@/lib/auth/rbac";
import { DashProvider, OPERATION_COOKIE } from "@/components/dashboard/dash-provider";
import { DashboardShell } from "@/components/dashboard/shell";

export const metadata: Metadata = { title: "Coordination Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getPageSession();
  if (!session || session.mustChangePassword) redirect("/login");
  if (session.role === "FIELD_VOLUNTEER") redirect("/field");

  // Coordinators only see operations their organisation is an approved member of.
  const where: Prisma.OperationWhereInput =
    session.role === "GROUP_COORDINATOR" ? { memberships: { some: { organisationId: session.organisationId ?? "", status: "Approved" } } } : {};
  const operations = await prisma.operation.findMany({ where, orderBy: [{ status: "asc" }, { startDate: "desc" }], select: { operationId: true, name: true, status: true } });
  const chosen = (await cookies()).get(OPERATION_COOKIE)?.value;
  const initial = operations.find((o) => o.operationId === chosen) ?? operations.find((o) => o.status === "Active") ?? operations[0] ?? null;
  const permissions = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(session.role, p));

  return (
    <DashProvider
      user={{ userId: session.userId, fullName: session.fullName, role: session.role, organisationId: session.organisationId, organisationName: session.organisationName }}
      locale={await getLocale()}
      permissions={permissions}
      operations={operations}
      initialOperationId={initial?.operationId ?? null}
    >
      <DashboardShell>{children}</DashboardShell>
    </DashProvider>
  );
}
