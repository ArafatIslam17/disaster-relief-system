import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n/server";
import { PublicShell } from "@/components/public/public-shell";
import { RegisterAccountForm } from "@/components/public/register-forms";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const locale = await getLocale();
  const organisations = await prisma.organisation.findMany({ where: { status: "Approved" }, select: { organisationId: true, name: true }, orderBy: { name: "asc" } });
  return (
    <PublicShell locale={locale}>
      <RegisterAccountForm locale={locale} organisations={organisations} />
    </PublicShell>
  );
}
