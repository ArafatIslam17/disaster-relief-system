import { Suspense } from "react";
import { requireSection } from "@/lib/auth/page-guard";
import { ConflictsView } from "@/components/dashboard/conflicts-view";

export default async function ConflictsPage() {
  await requireSection("conflicts");
  return (
    <Suspense>
      <ConflictsView />
    </Suspense>
  );
}
