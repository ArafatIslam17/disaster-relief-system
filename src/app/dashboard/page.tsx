import { redirect } from "next/navigation";
import { getPageSession } from "@/lib/auth/page-session";
import { NAV, canOpen } from "@/lib/dashboard-nav";

export default async function DashboardIndex() {
  const s = await getPageSession();
  if (!s) redirect("/login");
  redirect(NAV.find((n) => canOpen(s.role, n.section))?.href ?? "/");
}
