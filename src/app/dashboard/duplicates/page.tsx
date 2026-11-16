import { Suspense } from "react";
import { requireSection } from "@/lib/auth/page-guard";
import { DuplicatesView } from "@/components/dashboard/duplicates-view";

export default async function DuplicatesPage() {
  await requireSection("duplicates");
  return (
    <Suspense>
      <DuplicatesView />
    </Suspense>
  );
}
