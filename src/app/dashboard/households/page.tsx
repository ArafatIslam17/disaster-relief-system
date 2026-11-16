import { Suspense } from "react";
import { requireSection } from "@/lib/auth/page-guard";
import { HouseholdsView } from "@/components/dashboard/households-view";

export default async function HouseholdsPage() {
  await requireSection("households");
  return (
    <Suspense>
      <HouseholdsView />
    </Suspense>
  );
}
