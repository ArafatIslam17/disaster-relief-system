"use client";

import { useMemo, useState } from "react";
import { placeName } from "@/lib/i18n/dictionary";
import { api, qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LoadState, Notice, PageHeader } from "./common";
import { useDash } from "./dash-provider";

type AreaRow = {
  areaId: string;
  upazila: string;
  unionName: string;
  ward: string;
  registered: number;
  served: number;
  unserved: number;
  anonymousDistributions: number;
  status: "NoRecords" | "Unserved" | "Served";
  lastReleasedAt: string | null;
  lastDistributionAt: string | null;
};
type Coverage = { areas: AreaRow[]; lastSyncedAt: string | null };
type HouseholdLite = { householdId: string; shortCode: string; headName: string; mobileNumber: string | null; mobileMasked: boolean; memberCount: number };

/** UC-21 / UC-22, Sequence Diagram 06. Observers get area-level figures only (NFR06). */
export function CoverageView() {
  const { t, locale, operation, can, user } = useDash();
  const { data, error, loading, reload } = useApi<Coverage>(operation ? `/api/coverage${qs({ operationId: operation.operationId })}` : null);
  const [upazila, setUpazila] = useState("");
  const [union, setUnion] = useState("");
  const [ward, setWard] = useState("");
  const [drawerArea, setDrawerArea] = useState<AreaRow | null>(null);
  const showHouseholds = user.role !== "OBSERVER" && can("coverage.release") && can("household.read");

  const areas = useMemo(() => data?.areas ?? [], [data]);
  const upazilas = [...new Set(areas.map((a) => a.upazila))];
  const unions = [...new Set(areas.filter((a) => !upazila || a.upazila === upazila).map((a) => a.unionName))];
  const wards = [...new Set(areas.filter((a) => (!upazila || a.upazila === upazila) && (!union || a.unionName === union)).map((a) => a.ward))].sort();
  const rows = areas.filter((a) => (!upazila || a.upazila === upazila) && (!union || a.unionName === union) && (!ward || a.ward === ward));
  const totals = rows.reduce((s, a) => ({ registered: s.registered + a.registered, served: s.served + a.served, unserved: s.unserved + a.unserved }), { registered: 0, served: 0, unserved: 0 });
  const areaName = (a: AreaRow) => `${placeName(a.upazila, locale)} / ${placeName(a.unionName, locale)} / ${a.ward}`;

  return (
    <div>
      <PageHeader title={t("coverageTitle")}>
        <span className="num text-xs text-ink-muted">{data?.lastSyncedAt ? t("lastSynced", { time: fmtDateTime(data.lastSyncedAt, locale) }) : t("neverSynced")}</span>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <Filter label={t("upazila")} value={upazila} onChange={(v) => { setUpazila(v); setUnion(""); setWard(""); }} options={upazilas.map((u) => [u, placeName(u, locale)])} />
        <Filter label={t("union")} value={union} onChange={(v) => { setUnion(v); setWard(""); }} options={unions.map((u) => [u, placeName(u, locale)])} />
        <Filter label={t("ward")} value={ward} onChange={setWard} options={wards.map((w) => [w, w])} />
        {user.role === "OBSERVER" && <span className="text-xs text-ink-muted">{t("observerNote")}</span>}
      </div>

      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colArea")}</TableHead>
              <TableHead className="text-right">{t("registered")}</TableHead>
              <TableHead className="text-right">{t("served")}</TableHead>
              <TableHead className="text-right">{t("unserved")}</TableHead>
              <TableHead>{t("lastDistribution")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              {showHouseholds && <TableHead className="text-right">{t("actions")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-ink-muted">
                  {t("noAreasMatch")}
                </TableCell>
              </TableRow>
            )}
            {rows.map((a) => (
              <TableRow key={a.areaId}>
                <TableCell className={locale === "bn" ? "font-bangla" : undefined}>{areaName(a)}</TableCell>
                <TableCell className="num text-right">{a.registered}</TableCell>
                <TableCell className="num text-right">{a.served}</TableCell>
                <TableCell className="num text-right font-semibold">{a.unserved}</TableCell>
                <TableCell className="num text-ink-muted">{fmtDateTime(a.lastDistributionAt, locale)}</TableCell>
                <TableCell>
                  <StatusBadge status={a.status} locale={locale} bilingual />
                </TableCell>
                {showHouseholds && (
                  <TableCell className="text-right">
                    <Button size="sm" variant="secondary" disabled={a.unserved === 0} onClick={() => setDrawerArea(a)}>
                      {t("viewUnserved")}
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow className="bg-canvas font-semibold">
                <TableCell>{t("total")}</TableCell>
                <TableCell className="num text-right">{totals.registered}</TableCell>
                <TableCell className="num text-right">{totals.served}</TableCell>
                <TableCell className="num text-right">{totals.unserved}</TableCell>
                <TableCell colSpan={showHouseholds ? 3 : 2} />
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {showHouseholds && (
        <Sheet open={drawerArea !== null} onOpenChange={(o) => !o && setDrawerArea(null)}>
          {drawerArea && operation && (
            <UnservedDrawer area={drawerArea} title={t("drawerTitle", { area: areaName(drawerArea) })} operationId={operation.operationId} canRelease={operation.status === "Active"} onReleased={reload} />
          )}
        </Sheet>
      )}
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  const { t } = useDash();
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
      {label}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="min-w-[170px]">
        <option value="">{t("all")}</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

function UnservedDrawer({ area, title, operationId, canRelease, onReleased }: { area: AreaRow; title: string; operationId: string; canRelease: boolean; onReleased: () => void }) {
  const { t, locale } = useDash();
  const { data, error, loading, reload } = useApi<{ households: HouseholdLite[] }>(`/api/households${qs({ operationId, areaId: area.areaId, unserved: "true", limit: 200 })}`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);

  async function release() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api<{ households: number; releasedAt: string }>("/api/coverage/release-unserved", { body: { areaId: area.areaId } });
      setMessage({ tone: "ok", text: t("released", { n: r.households, time: fmtDateTime(r.releasedAt, locale) }) });
      onReleased();
    } catch (err) {
      setMessage({ tone: "danger", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SheetContent title={title} description={area.lastReleasedAt ? t("lastReleased", { time: fmtDateTime(area.lastReleasedAt, locale) }) : undefined}>
      <div className="space-y-4">
        <div className="space-y-2 rounded-md border border-line bg-canvas p-3">
          <p className="text-sm text-ink-muted">{t("releaseHint")}</p>
          <Button onClick={release} disabled={busy || !canRelease || (data?.households.length ?? 0) === 0}>
            {t("releaseButton")}
          </Button>
          {message && <Notice tone={message.tone}>{message.text}</Notice>}
        </div>
        <LoadState loading={loading} error={error} onRetry={reload} />
        {data && data.households.length === 0 && <p className="text-sm text-ink-muted">{t("allServed")}</p>}
        {data && data.households.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shortCode")}</TableHead>
                <TableHead>{t("headName")}</TableHead>
                <TableHead>{t("mobile")}</TableHead>
                <TableHead className="text-right">{t("members")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.households.map((h) => (
                <TableRow key={h.householdId}>
                  <TableCell className="num font-semibold">{h.shortCode}</TableCell>
                  <TableCell>{h.headName}</TableCell>
                  <TableCell className="num">{h.mobileNumber ?? "—"}</TableCell>
                  <TableCell className="num text-right">{h.memberCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SheetContent>
  );
}
