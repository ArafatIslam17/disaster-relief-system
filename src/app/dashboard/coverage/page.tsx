import { requireSection } from "@/lib/auth/page-guard";
import { CoverageView } from "@/components/dashboard/coverage-view";

export default async function CoveragePage() {
  await requireSection("coverage");
  return <CoverageView />;
}
