import { requireSection } from "@/lib/auth/page-guard";
import { ReportsView } from "@/components/dashboard/reports-view";

export default async function ReportsPage() {
  await requireSection("reports");
  return <ReportsView />;
}
