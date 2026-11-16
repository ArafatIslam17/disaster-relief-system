import { getLocale } from "@/lib/i18n/server";
import { PublicShell } from "@/components/public/public-shell";
import { RegisterOrganisationForm } from "@/components/public/register-forms";

export const dynamic = "force-dynamic";

export default async function RegisterOrganisationPage() {
  const locale = await getLocale();
  return (
    <PublicShell locale={locale}>
      <RegisterOrganisationForm locale={locale} />
    </PublicShell>
  );
}
