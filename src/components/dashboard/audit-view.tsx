"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api, qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { buttonVariants } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorText, LoadState, PageHeader } from "./common";
import { useDash } from "./dash-provider";

type Facets = { actions: string[]; users: { id: string; name: string }[]; organisations: { id: string; name: string }[]; devices: { id: string; name: string }[] };
type Entry = {
  auditId: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  user: { fullName: string } | null;
  organisation: { name: string } | null;
  device: { deviceLabel: string } | null;
};

/** Dates are picked in Asia/Dhaka and sent as offset timestamps. */
const dayStart = (d: string) => (d ? `${d}T00:00:00+06:00` : undefined);
const dayEnd = (d: string) => (d ? `${d}T23:59:59.999+06:00` : undefined);

/** UC-24 / NFR12: read-only audit trail. There are no edit or delete controls by design. */
export function AuditView() {
  const { t, locale } = useDash();
  const facets = useApi<Facets>("/api/audit/facets");
  const [f, setF] = useState({ userId: "", organisationId: "", deviceId: "", action: "", from: "", to: "" });
  const filters = { userId: f.userId, organisationId: f.organisationId, deviceId: f.deviceId, action: f.action, from: dayStart(f.from), to: dayEnd(f.to) };
  const query = qs(filters);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (after: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const sep = query ? "&" : "?";
        const r = await api<{ entries: Entry[]; nextCursor: string | null }>(`/api/audit${query}${sep}limit=100${after ? `&cursor=${after}` : ""}`);
        setEntries((prev) => (after ? [...prev, ...r.entries] : r.entries));
        setCursor(r.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  const select = (key: keyof typeof f, label: string, options: { id: string; name: string }[]) => (
    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
      {label}
      <NativeSelect value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} className="max-w-[220px]">
        <option value="">{t("any")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));

  return (
    <div>
      <PageHeader title={t("auditTitle")}>
        <span className="text-xs text-ink-muted">{t("auditHint")}</span>
        <a href={`/api/audit${qs({ ...filters, format: "csv" })}`} className={buttonVariants({ variant: "secondary", size: "sm" })} download>
          <Download aria-hidden /> {t("exportCsv")}
        </a>
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        {select("userId", t("filterUser"), facets.data?.users ?? [])}
        {select("organisationId", t("filterOrg"), facets.data?.organisations ?? [])}
        {select("deviceId", t("filterDevice"), facets.data?.devices ?? [])}
        {select("action", t("filterAction"), (facets.data?.actions ?? []).map((a) => ({ id: a, name: a })))}
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("from")}
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className="h-9 w-40" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("to")}
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className="h-9 w-40" />
        </label>
      </div>
      <ErrorText>{facets.error}</ErrorText>
      <LoadState loading={loading && entries.length === 0} error={error} onRetry={() => void fetchPage(null)} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("time")}</TableHead>
            <TableHead>{t("filterAction")}</TableHead>
            <TableHead>{t("entity")}</TableHead>
            <TableHead>{t("filterUser")}</TableHead>
            <TableHead>{t("filterOrg")}</TableHead>
            <TableHead>{t("filterDevice")}</TableHead>
            <TableHead>{t("change")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!loading && entries.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-ink-muted">
                {t("auditEmpty")}
              </TableCell>
            </TableRow>
          )}
          {entries.map((e) => (
            <TableRow key={e.auditId} className="align-top">
              <TableCell className="num whitespace-nowrap text-xs">{fmtDateTime(e.createdAt, locale)}</TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">{e.action}</TableCell>
              <TableCell className="text-xs">
                {e.entityType}
                <span className="num block max-w-[140px] truncate text-ink-muted" title={e.entityId}>
                  {e.entityId}
                </span>
              </TableCell>
              <TableCell className="text-xs">{e.user?.fullName ?? "—"}</TableCell>
              <TableCell className="text-xs">{e.organisation?.name ?? "—"}</TableCell>
              <TableCell className="text-xs">{e.device?.deviceLabel ?? "—"}</TableCell>
              <TableCell className="max-w-[360px] font-mono text-[11px] leading-snug text-ink-muted">
                {e.oldValue !== null && <span className="block break-all">− {json(e.oldValue)}</span>}
                {e.newValue !== null && <span className="block break-all text-ink">+ {json(e.newValue)}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {cursor && (
        <div className="mt-3">
          <Button variant="secondary" onClick={() => void fetchPage(cursor)} disabled={loading}>
            {loading ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
