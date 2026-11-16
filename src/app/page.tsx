import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Building2, LogIn, Smartphone, UserPlus } from "lucide-react";
import { dashTranslator } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/server";
import { getPageSession, homeFor } from "@/lib/auth/page-session";
import { PublicShell } from "@/components/public/public-shell";

export const dynamic = "force-dynamic";

/** Entry portal. Signed-in users go straight to their workspace. */
export default async function Portal() {
  const session = await getPageSession();
  if (session) redirect(session.mustChangePassword ? "/login" : homeFor(session.role));
  const locale = await getLocale();
  const t = dashTranslator(locale);
  const cards = [
    { href: "/login", icon: LogIn, title: t("cardSignIn"), body: t("cardSignInBody") },
    { href: "/register", icon: UserPlus, title: t("cardRegisterAccount"), body: t("cardRegisterAccountBody") },
    { href: "/register/organisation", icon: Building2, title: t("cardRegisterOrg"), body: t("cardRegisterOrgBody") },
  ];
  return (
    <PublicShell locale={locale} narrow={false}>
      <h1 className="text-xl font-semibold text-ink">{t("portalTitle")}</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{t("portalLead")}</p>
      <ul className="mt-6 grid gap-3 md:grid-cols-3">
        {cards.map(({ href, icon: Icon, title, body }) => (
          <li key={href}>
            <Link href={href} className="flex h-full flex-col rounded-md border border-line bg-surface p-4 hover:border-primary">
              <span className="flex items-center gap-2 text-base font-semibold text-ink">
                <Icon className="size-5 text-primary" aria-hidden /> {title}
              </span>
              <span className="mt-2 flex-1 text-sm text-ink-muted">{body}</span>
              <span className="mt-3 flex items-center gap-1 text-sm font-semibold text-primary">
                {t("continue")} <ArrowRight className="size-4" aria-hidden />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/field" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline">
        <Smartphone className="size-4" aria-hidden /> {t("fieldAppLink")}
      </Link>
    </PublicShell>
  );
}
