import "server-only";
import { redirect } from "next/navigation";
import { canOpen, type DashSection } from "../dashboard-nav";
import { getPageSession, homeFor, type PageSession } from "./page-session";

/** Server-side gate for a dashboard page. Hiding a nav link is never the only protection. */
export async function requireSection(section: DashSection): Promise<PageSession> {
  const s = await getPageSession();
  if (!s) redirect("/login");
  if (s.mustChangePassword) redirect("/login");
  if (!canOpen(s.role, section)) redirect(homeFor(s.role) === "/field" ? "/field" : "/dashboard");
  return s;
}
