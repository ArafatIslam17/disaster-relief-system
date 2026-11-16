import { requireSection } from "@/lib/auth/page-guard";
import { AuditView } from "@/components/dashboard/audit-view";

export default async function AuditPage() {
  await requireSection("audit");
  return <AuditView />;
}
