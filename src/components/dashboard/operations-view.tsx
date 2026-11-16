"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { placeName } from "@/lib/i18n/dictionary";
import { api } from "@/lib/client-api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { areasToCsv, previewAreaCsv, type AreaInput, type CsvReject } from "@/lib/area-csv";
import { useApi } from "@/hooks/useApi";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, ErrorText, LoadState, Notice, PageHeader, Panel } from "./common";
import { useDash } from "./dash-provider";

type OperationRow = { operationId: string; name: string; disasterType: string; startDate: string; endDate: string | null; status: "Active" | "Closed"; closedAt: string | null; areaCount: number; reliefItemCount: number };
type Setup = {
  operation: { operationId: string; name: string; status: "Active" | "Closed" };
  areas: (AreaInput & { areaId: string })[];
  reliefItems: { itemId: string; itemName: string; unit: string; inUse: boolean }[];
};

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

/** UC-06 / UC-07: operations, areas (manual + CSV), relief items. Operation Administrator only. */
export function OperationsView() {
  const { t, locale, operation, setOperationId } = useDash();
  const router = useRouter();
  const ops = useApi<{ operations: OperationRow[] }>("/api/operations");
  const [form, setForm] = useState({ name: "", disasterType: "", startDate: new Date().toISOString().slice(0, 10) });
  const create = useSubmit();
  const [closeOpen, setCloseOpen] = useState(false);
  const close = useSubmit();
  /** Bumped after a close so the setup panel refetches its (now read-only) state. */
  const [setupRev, setSetupRev] = useState(0);

  return (
    <div className="space-y-5">
      <PageHeader title={t("operationsTitle")} />
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <Panel title={t("operationsList")}>
          <LoadState loading={ops.loading && !ops.data} error={ops.error} onRetry={ops.reload} />
          {ops.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("operationName")}</TableHead>
                  <TableHead>{t("disasterType")}</TableHead>
                  <TableHead>{t("started")}</TableHead>
                  <TableHead className="text-right">{t("areas")}</TableHead>
                  <TableHead className="text-right">{t("reliefItems")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ops.data.operations.map((o) => (
                  <TableRow key={o.operationId} className={o.operationId === operation?.operationId ? "bg-status-ok-bg" : "cursor-pointer hover:bg-canvas"} onClick={() => setOperationId(o.operationId)}>
                    <TableCell className="font-medium">{o.name}</TableCell>
                    <TableCell>{o.disasterType}</TableCell>
                    <TableCell className="num">{fmtDate(o.startDate, locale)}</TableCell>
                    <TableCell className="num text-right">{o.areaCount}</TableCell>
                    <TableCell className="num text-right">{o.reliefItemCount}</TableCell>
                    <TableCell>
                      <StatusBadge status={o.status} locale={locale} />
                      {o.closedAt && <span className="num ml-2 text-xs text-ink-muted">{fmtDateTime(o.closedAt, locale)}</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Panel>
        <Panel title={t("createOperation")}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create.run(async () => {
                const r = await api<{ operationId: string }>("/api/operations", { body: form });
                setForm({ ...form, name: "", disasterType: "" });
                setOperationId(r.operationId);
                await ops.reload();
                router.refresh();
              });
            }}
          >
            <LabeledInput label={t("operationName")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <LabeledInput label={t("disasterType")} value={form.disasterType} onChange={(v) => setForm({ ...form, disasterType: v })} />
            <LabeledInput label={t("startDate")} type="date" value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
            <ErrorText>{create.error}</ErrorText>
            <Button type="submit" disabled={create.busy || form.name.trim().length < 5 || form.disasterType.trim().length < 3}>
              {t("create")}
            </Button>
          </form>
        </Panel>
      </div>

      {operation && (
        <OperationSetup
          key={`${operation.operationId}:${setupRev}`}
          operationId={operation.operationId}
          onClose={() => setCloseOpen(true)}
          onChanged={() => void ops.reload()}
        />
      )}

      {operation && (
        <ConfirmDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          title={t("closeTitle", { name: operation.name })}
          body={t("closeBody")}
          confirmLabel={t("closeOperation")}
          danger
          busy={close.busy}
          error={close.error}
          onConfirm={() =>
            void close.run(async () => {
              await api(`/api/operations/${operation.operationId}`, { method: "PATCH", body: { action: "close" } });
              setCloseOpen(false);
              setSetupRev((n) => n + 1);
              await ops.reload();
              router.refresh();
            })
          }
        />
      )}
    </div>
  );
}

function LabeledInput({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
      {label}
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="h-9" />
    </label>
  );
}

function OperationSetup({ operationId, onClose, onChanged }: { operationId: string; onClose: () => void; onChanged: () => void }) {
  const { t, locale } = useDash();
  const setup = useApi<Setup>(`/api/operations/${operationId}/setup`);
  const [area, setArea] = useState({ upazila: "", unionName: "", ward: "" });
  const addArea = useSubmit();
  const [preview, setPreview] = useState<{ headerOk: boolean; valid: AreaInput[]; rejected: CsvReject[]; totalRows: number } | null>(null);
  const importer = useSubmit();
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [item, setItem] = useState({ itemName: "", unit: "" });
  const addItem = useSubmit();

  if (!setup.data) return <LoadState loading={setup.loading} error={setup.error} onRetry={setup.reload} />;
  const s = setup.data;
  const closed = s.operation.status === "Closed";
  const reasonText = (r: CsvReject) => (r.reason === "missing" ? t("reasonMissing") : r.reason === "length" ? t("reasonLength") : r.reason === "duplicate" ? t("reasonDuplicate") : (r.detail ?? ""));
  const post = (body: unknown) => api(`/api/operations/${operationId}/setup`, { body });
  const refresh = async () => {
    await setup.reload();
    onChanged();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <h2 className="text-base font-semibold text-ink">{t("setupFor", { name: s.operation.name })}</h2>
        {!closed && (
          <Button variant="danger" onClick={onClose}>
            {t("closeOperation")}
          </Button>
        )}
      </div>
      {closed && <Notice tone="neutral">{t("operationClosedNote")}</Notice>}

      <div className="grid grid-cols-[1fr_1fr] gap-5">
        <Panel title={`${t("areas")} (${s.areas.length})`}>
          {s.areas.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("noAreas")}</p>
          ) : (
            <div className="max-h-[360px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("upazila")}</TableHead>
                    <TableHead>{t("union")}</TableHead>
                    <TableHead>{t("ward")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.areas.map((a) => (
                    <TableRow key={a.areaId}>
                      <TableCell>{placeName(a.upazila, locale)}</TableCell>
                      <TableCell>{placeName(a.unionName, locale)}</TableCell>
                      <TableCell className="num">{a.ward}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {!closed && (
            <form
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                void addArea.run(async () => {
                  await post({ action: "addArea", area });
                  setArea({ upazila: "", unionName: "", ward: "" });
                  await refresh();
                });
              }}
            >
              <LabeledInput label={t("upazila")} value={area.upazila} onChange={(v) => setArea({ ...area, upazila: v })} />
              <LabeledInput label={t("union")} value={area.unionName} onChange={(v) => setArea({ ...area, unionName: v })} />
              <div className="w-20">
                <LabeledInput label={t("ward")} value={area.ward} onChange={(v) => setArea({ ...area, ward: v })} />
              </div>
              <Button type="submit" disabled={addArea.busy || !area.upazila || !area.unionName || !area.ward}>
                {t("addArea")}
              </Button>
              <div className="w-full">
                <ErrorText>{addArea.error}</ErrorText>
              </div>
            </form>
          )}
        </Panel>

        {!closed && (
          <Panel title={t("csvUpload")}>
            <p className="mb-3 text-sm text-ink-muted">{t("csvHint")}</p>
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label={t("csvUpload")}
              className="block text-sm text-ink file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-surface file:px-3 file:text-sm file:font-medium"
              onChange={async (e) => {
                setImportMsg(null);
                const file = e.target.files?.[0];
                if (!file) return setPreview(null);
                setPreview(previewAreaCsv(await file.text(), s.areas));
              }}
            />
            {preview && !preview.headerOk && (
              <div className="mt-3">
                <Notice tone="danger">{t("reasonHeader")}</Notice>
              </div>
            )}
            {preview?.headerOk && (
              <div className="mt-3 space-y-3">
                <div className="flex gap-3 text-sm">
                  <StatusBadgeCount tone="ok" text={t("previewValid", { n: preview.valid.length })} />
                  <StatusBadgeCount tone="danger" text={t("previewRejected", { n: preview.rejected.length })} />
                </div>
                {preview.rejected.length > 0 && (
                  <div className="max-h-[160px] overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("row")}</TableHead>
                          <TableHead>{t("reason")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.rejected.map((r, i) => (
                          <TableRow key={`${r.row}-${i}`}>
                            <TableCell className="num">{r.row}</TableCell>
                            <TableCell className="text-status-danger-fg">{reasonText(r)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {preview.valid.length > 0 && (
                  <div className="max-h-[160px] overflow-y-auto">
                    <Table>
                      <TableBody>
                        {preview.valid.map((a) => (
                          <TableRow key={`${a.upazila}|${a.unionName}|${a.ward}`}>
                            <TableCell>{a.upazila}</TableCell>
                            <TableCell>{a.unionName}</TableCell>
                            <TableCell className="num">{a.ward}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <Button
                  disabled={importer.busy || preview.valid.length === 0}
                  onClick={() =>
                    void importer.run(async () => {
                      const r = await api<{ validCount: number; rejectedCount: number }>(`/api/operations/${operationId}/setup`, { body: { action: "importAreasCsv", csv: areasToCsv(preview.valid) } });
                      setImportMsg(t("imported", { valid: r.validCount, rejected: r.rejectedCount }));
                      setPreview(null);
                      await refresh();
                    })
                  }
                >
                  {t("importValid", { n: preview.valid.length })}
                </Button>
              </div>
            )}
            <div className="mt-2 space-y-2">
              <ErrorText>{importer.error}</ErrorText>
              {importMsg && <Notice tone="ok">{importMsg}</Notice>}
            </div>
          </Panel>
        )}
      </div>

      <Panel title={`${t("reliefItems")} (${s.reliefItems.length})`}>
        {s.reliefItems.length === 0 && <p className="mb-3 text-sm text-ink-muted">{t("noItems")}</p>}
        {s.reliefItems.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("itemName")}</TableHead>
                <TableHead>{t("unit")}</TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {s.reliefItems.map((i) => (
                <ItemRow key={i.itemId} item={i} readOnly={closed} post={post} onChanged={refresh} />
              ))}
            </TableBody>
          </Table>
        )}
        {!closed && (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addItem.run(async () => {
                await post({ action: "addItem", ...item });
                setItem({ itemName: "", unit: "" });
                await refresh();
              });
            }}
          >
            <LabeledInput label={t("itemName")} value={item.itemName} onChange={(v) => setItem({ ...item, itemName: v })} />
            <LabeledInput label={t("unit")} value={item.unit} onChange={(v) => setItem({ ...item, unit: v })} />
            <Button type="submit" disabled={addItem.busy || item.itemName.trim().length < 2 || !item.unit.trim()}>
              {t("addItem")}
            </Button>
            <div className="w-full">
              <ErrorText>{addItem.error}</ErrorText>
            </div>
          </form>
        )}
      </Panel>
    </div>
  );
}

function StatusBadgeCount({ tone, text }: { tone: "ok" | "danger"; text: string }) {
  return <span className={tone === "ok" ? "num rounded-sm bg-status-ok-bg px-2 py-0.5 font-semibold text-status-ok-fg" : "num rounded-sm bg-status-danger-bg px-2 py-0.5 font-semibold text-status-danger-fg"}>{text}</span>;
}

function ItemRow({ item, readOnly, post, onChanged }: { item: Setup["reliefItems"][number]; readOnly: boolean; post: (b: unknown) => Promise<unknown>; onChanged: () => Promise<void> }) {
  const { t } = useDash();
  const [name, setName] = useState(item.itemName);
  const [unit, setUnit] = useState(item.unit);
  const s = useSubmit();
  const dirty = name !== item.itemName || unit !== item.unit;
  return (
    <TableRow>
      <TableCell>{readOnly ? item.itemName : <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8" aria-label={t("itemName")} />}</TableCell>
      <TableCell>{readOnly ? item.unit : <Input value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 w-28" aria-label={t("unit")} />}</TableCell>
      <TableCell className="text-right">
        {!readOnly && (
          <div className="flex items-center justify-end gap-2">
            {dirty && (
              <Button size="sm" onClick={() => void s.run(async () => { await post({ action: "updateItem", itemId: item.itemId, itemName: name.trim(), unit: unit.trim() }); await onChanged(); })} disabled={s.busy}>
                {t("save")}
              </Button>
            )}
            {item.inUse ? (
              <span className="text-xs text-ink-muted">{t("inUse")}</span>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => void s.run(async () => { await post({ action: "removeItem", itemId: item.itemId }); await onChanged(); })} disabled={s.busy}>
                {t("remove")}
              </Button>
            )}
          </div>
        )}
        {s.error && <ErrorText>{s.error}</ErrorText>}
      </TableCell>
    </TableRow>
  );
}
