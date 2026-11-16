"use client";

import { Download, Printer } from "lucide-react";
import { placeName, STATUS_LABELS } from "@/lib/i18n/dictionary";
import { qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge, STATUS_TONE } from "@/components/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadState, PageHeader, Panel } from "./common";
import { useDash } from "./dash-provider";

type ItemTotal = { itemId: string; itemName: string; unit: string; quantity: number };
type OrgReport = {
  kind: "organisation";
  operation: { name: string };
  organisation: string;
  generatedAt: string;
  summary: { householdsRegistered: number; householdsServed: number; activeDistributions: number; anonymousDistributions: number; voidedDistributions: number };
  itemTotals: ItemTotal[];
  rows: { distributedAt: string; shortCode: string; memberCount: number | ""; upazila: string; union: string; ward: string; items: string; recordedBy: string; status: "Active" | "Voided"; cancelReason: string }[];
};
type SummaryReport = {
  kind: "summary";
  operation: { name: string };
  generatedAt: string;
  items: { itemId: string; itemName: string; unit: string }[];
  areas: { upazila: string; union: string; ward: string; registered: number; served: number; unserved: number; anonymousDistributions: number; status: string; itemQuantities: Record<string, number> }[];
  itemTotals: ItemTotal[];
  organisations: { organisation: string; activeDistributions: number; householdsServed: number }[];
};

const statusKeyFromLabel = (label: string) => Object.keys(STATUS_LABELS).find((k) => STATUS_LABELS[k].en === label && STATUS_TONE[k]);

/** UC-25: organisation report (coordinators) or anonymised summary (admins, observers). CSV + print-to-PDF. */
export function ReportsView() {
  const { t, locale, operation, can } = useDash();
  const type = can("report.organisation") ? "organisation" : "summary";
  const query = qs({ type, operationId: operation?.operationId });
  const { data, error, loading, reload } = useApi<OrgReport | SummaryReport>(operation ? `/api/reports${query}` : null);

  return (
    <div className="space-y-4">
      <PageHeader title={type === "organisation" ? t("orgReport") : t("summaryReport")}>
        <div className="flex gap-2 print:hidden">
          <a href={`/api/reports${qs({ type, operationId: operation?.operationId, format: "csv" })}`} className={buttonVariants({ variant: "secondary", size: "sm" })} download>
            <Download aria-hidden /> {t("downloadCsv")}
          </a>
          <Button size="sm" onClick={() => window.print()} disabled={!data}>
            <Printer aria-hidden /> {t("exportPdf")}
          </Button>
        </div>
      </PageHeader>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <article className="space-y-4">
          <p className="num text-sm text-ink-muted">
            {data.operation.name}
            {data.kind === "organisation" && ` · ${data.organisation}`} · {t("generatedAt", { time: fmtDateTime(data.generatedAt, locale) })}
          </p>
          {data.kind === "summary" && <p className="text-sm text-ink-muted">{t("anonymisedNote")}</p>}

          {data.kind === "organisation" && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">{t("householdsRegistered")}</TableHead>
                  <TableHead className="text-right">{t("householdsServed")}</TableHead>
                  <TableHead className="text-right">{t("activeDistributions")}</TableHead>
                  <TableHead className="text-right">{t("anonymousDistributions")}</TableHead>
                  <TableHead className="text-right">{t("voidedDistributions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  {Object.values(data.summary).map((v, i) => (
                    <TableCell key={i} className="num text-right text-base font-semibold">
                      {v}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          )}

          <Panel title={t("itemTotals")}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("itemName")}</TableHead>
                  <TableHead>{t("unit")}</TableHead>
                  <TableHead className="text-right">{t("quantity")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itemTotals.map((i) => (
                  <TableRow key={i.itemId}>
                    <TableCell>{i.itemName}</TableCell>
                    <TableCell>{i.unit}</TableCell>
                    <TableCell className="num text-right">{i.quantity}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          {data.kind === "organisation" ? (
            <Panel title={t("distributions")}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("date")}</TableHead>
                    <TableHead>{t("shortCode")}</TableHead>
                    <TableHead>{t("ward")}</TableHead>
                    <TableHead>{t("items")}</TableHead>
                    <TableHead>{t("recordedBy")}</TableHead>
                    <TableHead>{t("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r, i) => (
                    <TableRow key={i} className="align-top">
                      <TableCell className="num whitespace-nowrap">{r.distributedAt}</TableCell>
                      <TableCell className="num font-semibold">{r.shortCode === "Anonymous" ? t("anonymous") : r.shortCode}</TableCell>
                      <TableCell>
                        {placeName(r.union, locale)} / {r.ward}
                      </TableCell>
                      <TableCell className="text-sm">{r.items}</TableCell>
                      <TableCell>{r.recordedBy}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} locale={locale} />
                        {r.cancelReason && <span className="mt-1 block text-xs text-status-danger-fg">{r.cancelReason}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          ) : (
            <>
              <Panel title={t("coverageByArea")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("colArea")}</TableHead>
                      <TableHead className="text-right">{t("registered")}</TableHead>
                      <TableHead className="text-right">{t("served")}</TableHead>
                      <TableHead className="text-right">{t("unserved")}</TableHead>
                      <TableHead className="text-right">{t("anonymousDistributions")}</TableHead>
                      {data.items.map((i) => (
                        <TableHead key={i.itemId} className="text-right">
                          {i.itemName}
                        </TableHead>
                      ))}
                      <TableHead>{t("status")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.areas.map((a) => {
                      const key = statusKeyFromLabel(a.status);
                      return (
                        <TableRow key={`${a.upazila}|${a.union}|${a.ward}`}>
                          <TableCell>
                            {placeName(a.upazila, locale)} / {placeName(a.union, locale)} / {a.ward}
                          </TableCell>
                          <TableCell className="num text-right">{a.registered}</TableCell>
                          <TableCell className="num text-right">{a.served}</TableCell>
                          <TableCell className="num text-right">{a.unserved}</TableCell>
                          <TableCell className="num text-right">{a.anonymousDistributions}</TableCell>
                          {data.items.map((i) => (
                            <TableCell key={i.itemId} className="num text-right">
                              {a.itemQuantities[i.itemName] ?? 0}
                            </TableCell>
                          ))}
                          <TableCell>{key ? <StatusBadge status={key} locale={locale} bilingual /> : a.status}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Panel>
              <Panel title={t("byOrganisation")}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("organisation")}</TableHead>
                      <TableHead className="text-right">{t("activeDistributions")}</TableHead>
                      <TableHead className="text-right">{t("householdsServed")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.organisations.map((o) => (
                      <TableRow key={o.organisation}>
                        <TableCell>{o.organisation}</TableCell>
                        <TableCell className="num text-right">{o.activeDistributions}</TableCell>
                        <TableCell className="num text-right">{o.householdsServed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Panel>
            </>
          )}
        </article>
      )}
    </div>
  );
}
