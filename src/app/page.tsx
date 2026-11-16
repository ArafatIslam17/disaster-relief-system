import { prisma } from "@/lib/db";
import { computeCoverage } from "@/lib/coverage";
import { getLocale } from "@/lib/i18n/server";
import { placeName, translator } from "@/lib/i18n/dictionary";
import { LocaleToggle } from "@/components/locale-toggle";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

export default async function CoveragePage() {
  const locale = await getLocale();
  const t = translator(locale);
  const operation = await prisma.operation.findFirst({
    where: { status: "Active" },
    orderBy: { startDate: "desc" },
  });
  const rows = operation ? await computeCoverage(operation.operationId) : [];
  const dateFmt = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD-u-nu-latn" : "en-GB", { dateStyle: "medium", timeZone: "Asia/Dhaka" });

  return (
    <div className="min-h-dvh">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
          <span className="text-sm font-semibold tracking-tight text-ink">{t("appName")}</span>
          <LocaleToggle locale={locale} ariaLabel={t("language")} />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">
        {operation ? (
          <section aria-labelledby="op-heading" className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("activeOperation")}</p>
              <h1 id="op-heading" className="text-xl font-semibold text-ink">{operation.name}</h1>
            </div>
            <dl className="flex gap-6 text-sm">
              <div>
                <dt className="text-ink-muted">{t("disasterType")}</dt>
                <dd className="font-medium">{operation.disasterType}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t("started")}</dt>
                <dd className="num font-medium">{dateFmt.format(operation.startDate)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">{t("status")}</dt>
                <dd><StatusBadge status={operation.status} locale={locale} /></dd>
              </div>
            </dl>
          </section>
        ) : (
          <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{t("noActiveOperation")}</p>
        )}

        {operation && (
          <section aria-labelledby="coverage-heading" className="space-y-3">
            <div>
              <h2 id="coverage-heading" className="text-base font-semibold">{t("coverage")}</h2>
              <p className="text-sm text-ink-muted">{t("coverageHint")}</p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("upazila")}</TableHead>
                  <TableHead>{t("union")}</TableHead>
                  <TableHead>{t("ward")}</TableHead>
                  <TableHead className="text-right">{t("registered")}</TableHead>
                  <TableHead className="text-right">{t("served")}</TableHead>
                  <TableHead className="text-right">{t("unserved")}</TableHead>
                  <TableHead className="text-right">{t("anonymous")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                    <TableRow key={r.areaId}>
                      <TableCell className={locale === "bn" ? "font-bangla" : undefined}>{placeName(r.upazila, locale)}</TableCell>
                      <TableCell className={locale === "bn" ? "font-bangla" : undefined}>{placeName(r.unionName, locale)}</TableCell>
                      <TableCell className="num">{r.ward}</TableCell>
                      <TableCell className="num text-right">{r.registered}</TableCell>
                      <TableCell className="num text-right">{r.served}</TableCell>
                      <TableCell className="num text-right">{r.unserved}</TableCell>
                      <TableCell className="num text-right">{r.anonymousDistributions}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} locale={locale} />
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        )}
      </main>
    </div>
  );
}
