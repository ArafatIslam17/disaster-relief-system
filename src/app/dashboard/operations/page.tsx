import { requireSection } from "@/lib/auth/page-guard";
import { OperationsView } from "@/components/dashboard/operations-view";

export default async function OperationsPage() {
  await requireSection("operations");
  return <OperationsView />;
}
