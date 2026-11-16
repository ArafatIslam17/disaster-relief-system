import { redirect } from "next/navigation";
import { getLocale } from "@/lib/i18n/server";
import { getPageSession, homeFor } from "@/lib/auth/page-session";
import { PublicShell } from "@/components/public/public-shell";
import { LoginForm } from "@/components/public/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const session = await getPageSession();
  if (session && !session.mustChangePassword) redirect(homeFor(session.role));
  const locale = await getLocale();
  return (
    <PublicShell locale={locale}>
      <LoginForm locale={locale} mustChange={!!session?.mustChangePassword} role={session?.role ?? null} />
    </PublicShell>
  );
}
