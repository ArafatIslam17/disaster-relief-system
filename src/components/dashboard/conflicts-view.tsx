"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { FIELD_LABELS, placeName } from "@/lib/i18n/dictionary";
import { api, qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorText, KeyValues, LoadState, Notice, PageHeader } from "./common";
import { useDash } from "./dash-provider";

type Conflict = {
  conflictId: string;
  status: "Open" | "Resolved";
  fieldName: string;
  localValue: string | null;
  serverValue: string | null;
  resolvedValue: string | null;
  valuesMasked: boolean;
  clientTime: string;
  receivedAt: string;
  baseVersion: number;
  household: { householdId: string; shortCode: string; version: number; area: { upazila: string; unionName: string; ward: string } };
  localUser: { fullName: string };
  localDevice: { deviceLabel: string };
  resolvedBy: { fullName: string } | null;
  resolvedAt: string | null;
};

/** UC-17 / Sequence Diagram 04 / State Diagram 05. */
export function ConflictsView() {
  const { t, locale, operation } = useDash();
  const params = useSearchParams();
  const [showResolved, setShowResolved] = useState(false);
  const { data, error, loading, reload } = useApi<{ conflicts: Conflict[] }>(
    operation ? `/api/conflicts${qs({ status: showResolved ? "Resolved" : "Open", operationId: operation.operationId })}` : null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const [notice, setNotice] = useState<string | null>(null);
  const list = data?.conflicts ?? [];
  const selected = list.find((c) => c.conflictId === selectedId) ?? null;

  useEffect(() => {
    const id = params.get("id");
    if (id) setSelectedId(id);
  }, [params]);

  const fieldLabel = (f: string) => FIELD_LABELS[f]?.[locale] ?? f;

  return (
    <div>
      <PageHeader title={t("conflictsTitle")}>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={showResolved} onChange={(e) => { setShowResolved(e.target.checked); setSelectedId(null); }} className="size-4 accent-[var(--color-primary)]" />
          {t("showResolved")}
        </label>
      </PageHeader>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {notice && <div className="mb-3"><Notice tone="neutral">{notice}</Notice></div>}
      {data && (
        <div className="grid grid-cols-[minmax(300px,380px)_1fr] gap-4">
          <ul className="max-h-[calc(100dvh-170px)] overflow-y-auto rounded-md border border-line bg-surface" aria-label={t("conflictsTitle")}>
            {list.length === 0 && <li className="p-4 text-sm text-ink-muted">{showResolved ? t("noResolved") : t("conflictsEmpty")}</li>}
            {list.map((c) => (
              <li key={c.conflictId} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => { setSelectedId(c.conflictId); setNotice(null); }}
                  aria-current={c.conflictId === selectedId}
                  className={cn("block w-full px-3 py-2.5 text-left hover:bg-canvas", c.conflictId === selectedId && "bg-status-ok-bg")}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="num text-sm font-semibold text-ink">{c.household.shortCode}</span>
                    <StatusBadge status={c.status} locale={locale} />
                  </span>
                  <span className="block text-sm text-ink">{fieldLabel(c.fieldName)}</span>
                  <span className="num block text-xs text-ink-muted">
                    {c.localUser.fullName} · {fmtDateTime(c.clientTime, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <div>
            {selected ? (
              <ConflictDetail
                key={selected.conflictId}
                c={selected}
                fieldLabel={fieldLabel(selected.fieldName)}
                closed={operation?.status === "Closed"}
                onResolved={async () => {
                  const idx = list.findIndex((c) => c.conflictId === selected.conflictId);
                  const next = list[idx + 1] ?? list[idx - 1];
                  await reload();
                  setSelectedId(next?.conflictId ?? null);
                }}
                onLeaveOpen={() => {
                  setNotice(t("leftOpen"));
                  setSelectedId(null);
                }}
              />
            ) : (
              <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{t("selectConflict")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ConflictDetail({ c, fieldLabel, closed, onResolved, onLeaveOpen }: { c: Conflict; fieldLabel: string; closed: boolean; onResolved: () => void; onLeaveOpen: () => void }) {
  const { t, locale } = useDash();
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const empty = (v: string | null) => (v === null || v === "" ? <span className="text-ink-muted">{t("emptyValue")}</span> : v);

  async function resolve(choice: "local" | "server" | "custom") {
    setBusy(true);
    setError(null);
    try {
      const value = choice !== "custom" ? undefined : c.fieldName === "member_count" ? Number(custom) : custom.trim() === "" ? null : custom.trim();
      await api(`/api/conflicts/${c.conflictId}/resolve`, { body: { choice, value } });
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/dashboard/households?code=${c.household.shortCode}`} className="num text-lg font-semibold text-primary hover:underline">
            {c.household.shortCode}
          </Link>
          <p className={cn("text-sm text-ink-muted", locale === "bn" && "font-bangla")}>
            {placeName(c.household.area.upazila, locale)} / {placeName(c.household.area.unionName, locale)} / {c.household.area.ward}
          </p>
        </div>
        <StatusBadge status={c.status} locale={locale} />
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("field")}: <span className="normal-case text-ink">{fieldLabel}</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border-2 border-status-pending-fg bg-status-pending-bg p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-status-pending-fg">{t("localValue")}</p>
            <p className="num mt-1 break-words text-xl font-semibold text-ink">{empty(c.localValue)}</p>
          </div>
          <div className="rounded-md border-2 border-line-strong bg-canvas p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("serverValue")}</p>
            <p className="num mt-1 break-words text-xl font-semibold text-ink">{empty(c.serverValue)}</p>
          </div>
        </div>
        {c.valuesMasked && <p className="mt-2 text-xs text-ink-muted">{t("maskedValues")}</p>}
      </div>

      <KeyValues
        rows={[
          [t("volunteer"), c.localUser.fullName],
          [t("device"), c.localDevice.deviceLabel],
          [t("editedAt"), <span key="e" className="num">{fmtDateTime(c.clientTime, locale)}</span>],
          [t("receivedAt"), <span key="r" className="num">{fmtDateTime(c.receivedAt, locale)}</span>],
          [t("baseVersion"), <span key="b" className="num">{c.baseVersion} → {c.household.version}</span>],
        ]}
      />

      {c.status === "Resolved" ? (
        <Notice tone="ok">{t("resolvedBy", { name: c.resolvedBy?.fullName ?? "—", time: fmtDateTime(c.resolvedAt, locale), value: c.resolvedValue || t("emptyValue") })}</Notice>
      ) : (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-xs text-ink-muted">{t("resolveConsequence")}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => resolve("local")} disabled={busy || closed}>
              {t("acceptLocal")}
            </Button>
            <Button variant="secondary" onClick={() => resolve("server")} disabled={busy || closed}>
              {t("acceptServer")}
            </Button>
          </div>
          {!c.valuesMasked && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
                {t("customValue")}
                <Input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  inputMode={c.fieldName === "head_name" ? "text" : "numeric"}
                  className="num h-9 w-[260px]"
                />
              </label>
              <Button variant="secondary" onClick={() => resolve("custom")} disabled={busy || closed || (c.fieldName !== "mobile_number" && custom.trim() === "")}>
                {t("saveCustom")}
              </Button>
            </div>
          )}
          <Button variant="ghost" onClick={onLeaveOpen} disabled={busy}>
            {t("leaveOpen")}
          </Button>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}
