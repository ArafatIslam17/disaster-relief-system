import { Suspense } from "react";
import { requireSection } from "@/lib/auth/page-guard";
import { AdminView } from "@/components/dashboard/admin-view";

export default async function AdminPage() {
  await requireSection("admin");
  return (
    <Suspense>
      <AdminView />
    </Suspense>
  );
}
