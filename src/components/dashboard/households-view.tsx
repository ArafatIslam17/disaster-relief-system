"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_LABELS, placeName } from "@/lib/i18n/dictionary";
import { qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge, type StatusKey } from "@/components/status-badge";
import { Input } from "@/components/ui/input";
import { KeyValues, LoadState, PageHeader } from "./common";
import { useDash } from "./dash-provider";

type Area = { upazila: string; unionName: string; ward: string };
type ListItem = { householdId: string; shortCode: string; headName: string; memberCount: number; area: Area };
type Detail = {
  household: { householdId: string; shortCode: string; headName: string; mobileNumber: string | null; mobileMasked: boolean; memberCount: number; version: number; consentAt: string; gpsLocation: string | null; area: Area };
  openConflicts: number;
  versions: { version: number; headName: string; mobileNumber: string | null; memberCount: number; changeSource: "FIELD_EDIT" | "CONFLICT_RESOLUTION"; changedBy: string; createdAt: string }[];
  distributions: { distributionId: string; distributedAt: string; status: "Active" | "Voided"; cancelReason: string | null; recordedBy: string; organisation: string | null; items: { itemId: string; itemName: string; unit: string; quantity: number }[] }[];
  reviews: {
    conflicts: { conflictId: string; fieldName: string; status: "Open" | "Resolved"; localValue: string | null; serverValue: string | null; resolvedValue: string | null; raisedAt: string; raisedBy: string; resolvedAt: string | null; resolvedBy: string | null }[];
    duplicatePairs: { pairId: string; otherShortCode: string; score: string; label: string; status: "PendingReview" | "Linked" | "NotDuplicate"; reviewedAt: string | null; reviewedBy: string | null }[];
    flags: { flagId: string; status: "PendingReview" | "Justified" | "Repeat"; note: string | null; createdAt: string; reviewedAt: string | null; reviewedBy: string | null }[];
  };
};
type Event = { at: string; key: string; title: string; detail?: React.ReactNode; by?: string; status?: StatusKey };

/** UC-23: append-only history of one household, cross-org phones masked by the API. */
export function HouseholdsView() {
  const { t, locale, operation } = useDash();
  const params = useSearchParams();
  const router = useRouter();
  const code = params.get("code");
  const [q, setQ] = useState(code ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const list = useApi<{ households: ListItem[] }>(operation && debounced.length >= 2 ? `/api/households${qs({ operationId: operation.operationId, q: debounced, limit: 50 })}` : null);
  const detail = useApi<Detail>(code ? `/api/households/${encodeURIComponent(code)}` : null);

  return (
    <div>
      <PageHeader title={t("householdsTitle")} />
      <div className="grid grid-cols-[minmax(280px,340px)_1fr] gap-4">
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchHouseholds")} aria-label={t("searchHouseholds")} className="pl-8" />
          </div>
          {debounced.length < 2 ? (
            <p className="text-xs text-ink-muted">{t("searchHint")}</p>
          ) : (
            <>
              <LoadState loading={list.loading && !list.data} error={list.error} onRetry={list.reload} />
              <ul className="max-h-[calc(100dvh-230px)] overflow-y-auto rounded-md border border-line bg-surface">
                {list.data?.households.length === 0 && <li className="p-3 text-sm text-ink-muted">{t("noHouseholdsFound")}</li>}
                {list.data?.households.map((h) => (
                  <li key={h.householdId} className="border-b border-line last:border-b-0">
                    <button type="button" onClick={() => router.replace(`/dashboard/households?code=${h.shortCode}`)} className={cn("block w-full px-3 py-2 text-left hover:bg-canvas", code === h.shortCode && "bg-status-ok-bg")}>
                      <span className="num block text-sm font-semibold text-ink">{h.shortCode}</span>
                      <span className="block text-sm text-ink">{h.headName}</span>
                      <span className="block text-xs text-ink-muted">
                        {placeName(h.area.unionName, locale)} / {h.area.ward}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div>
          {!code && <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{t("selectHousehold")}</p>}
          {code && <LoadState loading={detail.loading && !detail.data} error={detail.error} onRetry={detail.reload} />}
          {code && detail.data && <Timeline d={detail.data} />}
        </div>
      </div>
    </div>
  );
}

function Timeline({ d }: { d: Detail }) {
  const { t, locale } = useDash();
  const field = (f: string) => FIELD_LABELS[f]?.[locale] ?? f;
  const h = d.household;

  const events: Event[] = (() => {
    const ev: Event[] = [];
    for (const v of d.versions) {
      ev.push({
        at: v.createdAt,
        key: `v${v.version}`,
        title: v.version === 1 ? t("evRegistered") : v.changeSource === "CONFLICT_RESOLUTION" ? t("evResolved", { n: v.version }) : t("evEdited", { n: v.version }),
        by: v.changedBy,
        detail: (
          <span className="num">
            {v.headName} · {v.mobileNumber ?? "—"} · {v.memberCount} {t("members").toLowerCase()}
          </span>
        ),
      });
    }
    for (const x of d.distributions) {
      ev.push({
        at: x.distributedAt,
        key: `d${x.distributionId}`,
        title: `${t("evDistribution")} · ${x.organisation ?? "—"}`,
        by: x.recordedBy,
        status: x.status,
        detail: (
          <>
            <span className="block">{x.items.map((i) => `${i.itemName} × ${i.quantity}`).join(", ")}</span>
            {x.status === "Voided" && x.cancelReason && <span className="block text-status-danger-fg">{t("cancelReason")}: {x.cancelReason}</span>}
          </>
        ),
      });
    }
    for (const c of d.reviews.conflicts) {
      ev.push({ at: c.raisedAt, key: `c${c.conflictId}`, title: t("evConflictRaised", { field: field(c.fieldName) }), by: c.raisedBy, status: "Open", detail: <span className="num">{c.localValue ?? "—"} ≠ {c.serverValue ?? "—"}</span> });
      if (c.resolvedAt) ev.push({ at: c.resolvedAt, key: `cr${c.conflictId}`, title: t("evConflictResolved", { field: field(c.fieldName) }), by: c.resolvedBy ?? undefined, status: "Resolved", detail: <span className="num">{c.resolvedValue || t("emptyValue")}</span> });
    }
    for (const p of d.reviews.duplicatePairs) {
      if (p.reviewedAt) ev.push({ at: p.reviewedAt, key: `p${p.pairId}`, title: t("evDuplicate", { code: p.otherShortCode }), by: p.reviewedBy ?? undefined, status: p.status, detail: <span className="num">{p.label} · {p.score}</span> });
    }
    for (const f of d.reviews.flags) {
      ev.push({ at: f.createdAt, key: `f${f.flagId}`, title: t("evFlagRaised"), status: "PendingReview" });
      if (f.reviewedAt) ev.push({ at: f.reviewedAt, key: `fr${f.flagId}`, title: t("evFlagReviewed"), by: f.reviewedBy ?? undefined, status: f.status, detail: f.note });
    }
    return ev.sort((a, b) => a.at.localeCompare(b.at));
  })();

  const pendingPairs = d.reviews.duplicatePairs.filter((p) => p.status === "PendingReview");

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-line bg-surface p-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <span className="num text-xl font-semibold text-ink">{h.shortCode}</span>
          <span className="text-base text-ink">{h.headName}</span>
          {d.openConflicts > 0 && <StatusBadge status="Open" locale={locale} />}
        </div>
        <KeyValues
          rows={[
            [t("mobile"), <span key="m" className="num">{h.mobileNumber ?? "—"}</span>],
            [t("members"), <span key="n" className="num">{h.memberCount}</span>],
            [t("ward"), `${placeName(h.area.upazila, locale)} / ${placeName(h.area.unionName, locale)} / ${h.area.ward}`],
            [t("version"), <span key="v" className="num">{h.version}</span>],
          ]}
        />
        {d.openConflicts > 0 && <p className="mt-2 text-sm text-status-danger-fg">{t("openConflicts", { n: d.openConflicts })}</p>}
        {pendingPairs.map((p) => (
          <p key={p.pairId} className="num mt-1 text-sm text-status-pending-fg">
            {t("evDuplicate", { code: p.otherShortCode })} · {p.label} {p.score}
          </p>
        ))}
      </div>
      <div className="rounded-md border border-line bg-surface">
        <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold text-ink">{t("timeline")}</h2>
        <ol className="relative px-4 py-3">
          {events.map((e) => (
            <li key={e.key} className="relative border-l-2 border-line pb-4 pl-4 last:pb-0">
              <span className="absolute -left-[5px] top-1.5 size-2 rounded-full bg-primary" aria-hidden />
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-xs text-ink-muted">{fmtDateTime(e.at, locale)}</span>
                <span className="text-sm font-semibold text-ink">{e.title}</span>
                {e.status && <StatusBadge status={e.status} locale={locale} />}
              </div>
              {e.detail && <div className="text-sm text-ink">{e.detail}</div>}
              {e.by && <p className="text-xs text-ink-muted">{t("byName", { name: e.by })}</p>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
