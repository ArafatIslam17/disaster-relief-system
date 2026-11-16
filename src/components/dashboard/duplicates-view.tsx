"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { placeName, STATUS_LABELS, type Locale } from "@/lib/i18n/dictionary";
import { api, qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, Textarea } from "@/components/ui/native-select";
import { ConfirmDialog, ErrorText, LoadState, Notice, PageHeader } from "./common";
import { useDash } from "./dash-provider";

type Area = { upazila: string; unionName: string; ward: string };
type PairHousehold = {
  householdId: string;
  shortCode: string;
  headName: string;
  mobileNumber: string | null;
  mobileMasked: boolean;
  memberCount: number;
  version: number;
  createdAt: string;
  area: Area;
  organisation: string | null;
};
type Pair = {
  pairId: string;
  score: string;
  label: "Likely" | "Possible";
  status: "PendingReview" | "Linked" | "NotDuplicate";
  reviewedBy: string | null;
  reviewedAt: string | null;
  mobileMatch: "exact" | "suffix" | "different" | "unknown";
  householdA: PairHousehold;
  householdB: PairHousehold;
};
type FlagDistribution = { distributionId: string; distributedAt: string; status: "Active" | "Voided"; organisation: string | null; recordedBy: string; area: Area; items: { itemId: string; itemName: string; unit: string; quantity: number }[] };
type Flag = { flagId: string; status: "PendingReview" | "Justified" | "Repeat"; note: string | null; createdAt: string; reviewedBy: string | null; reviewedAt: string | null; shortCode: string | null; hoursApart: number; sharedItems: string[]; first: FlagDistribution; second: FlagDistribution };

const areaText = (a: Area, l: Locale) => `${placeName(a.upazila, l)} / ${placeName(a.unionName, l)} / ${a.ward}`;

/** UC-18 / UC-19, Sequence Diagram 05, State Diagram 06. */
export function DuplicatesView() {
  const { t } = useDash();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "flags" ? "flags" : "pairs";
  const setTab = (next: "pairs" | "flags") => router.replace(next === "flags" ? "/dashboard/duplicates?tab=flags" : "/dashboard/duplicates");

  return (
    <div>
      <PageHeader title={t("duplicatesTitle")} />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {(["pairs", "flags"] as const).map((k) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === k ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {k === "pairs" ? t("tabDuplicates") : t("tabFlags")}
          </button>
        ))}
      </div>
      {tab === "pairs" ? <PairsTab initialId={params.get("pair")} /> : <FlagsTab initialId={params.get("flag")} />}
    </div>
  );
}

function QueueLayout({ list, detail }: { list: React.ReactNode; detail: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(300px,360px)_1fr] gap-4">
      <ul className="max-h-[calc(100dvh-220px)] overflow-y-auto rounded-md border border-line bg-surface">{list}</ul>
      <div>{detail}</div>
    </div>
  );
}

function PairsTab({ initialId }: { initialId: string | null }) {
  const { t, locale, operation } = useDash();
  const [status, setStatus] = useState<Pair["status"]>("PendingReview");
  const { data, error, loading, reload } = useApi<{ pairs: Pair[] }>(operation ? `/api/duplicates${qs({ status, operationId: operation.operationId })}` : null);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const pairs = data?.pairs ?? [];
  const selected = pairs.find((p) => p.pairId === selectedId) ?? null;

  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        {t("status")}
        <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value as Pair["status"]); setSelectedId(null); }}>
          {(["PendingReview", "Linked", "NotDuplicate"] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s][locale]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <QueueLayout
          list={
            <>
              {pairs.length === 0 && <li className="p-4 text-sm text-ink-muted">{t("duplicatesEmpty")}</li>}
              {pairs.map((p) => (
                <li key={p.pairId} className="border-b border-line last:border-b-0">
                  <button type="button" onClick={() => setSelectedId(p.pairId)} className={cn("block w-full px-3 py-2.5 text-left hover:bg-canvas", p.pairId === selectedId && "bg-status-ok-bg")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="num text-sm font-semibold text-ink">
                        {p.householdA.shortCode} ↔ {p.householdB.shortCode}
                      </span>
                      <Badge tone={p.label === "Likely" ? "danger" : "pending"} className="num">
                        {p.score}
                      </Badge>
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {p.label === "Likely" ? t("likelyBadge") : t("possibleBadge")} · {placeName(p.householdA.area.unionName, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </>
          }
          detail={selected ? <PairDetail key={selected.pairId} p={selected} closed={operation?.status === "Closed"} onChanged={reload} /> : <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{t("selectPair")}</p>}
        />
      )}
    </div>
  );
}

function PairDetail({ p, closed, onChanged }: { p: Pair; closed: boolean; onChanged: () => void }) {
  const { t, locale } = useDash();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const match = { exact: t("mobileExact"), suffix: t("mobileSuffix"), different: t("mobileDifferent"), unknown: t("mobileUnknown") }[p.mobileMatch];

  async function act(action: "confirmLink" | "markNotDuplicate" | "undoLink") {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/duplicates/${p.pairId}`, { body: { action } });
      setConfirmOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, (h: PairHousehold) => React.ReactNode, boolean][] = [
    [t("shortCode"), (h) => <Link href={`/dashboard/households?code=${h.shortCode}`} className="num font-semibold text-primary hover:underline">{h.shortCode}</Link>, false],
    [t("headName"), (h) => h.headName, p.householdA.headName !== p.householdB.headName],
    [t("mobile"), (h) => <span className="num">{h.mobileNumber ?? "—"}</span>, p.mobileMatch !== "exact"],
    [t("members"), (h) => <span className="num">{h.memberCount}</span>, p.householdA.memberCount !== p.householdB.memberCount],
    [t("ward"), (h) => areaText(h.area, locale), areaText(p.householdA.area, "en") !== areaText(p.householdB.area, "en")],
    [t("organisation"), (h) => h.organisation ?? "—", p.householdA.organisation !== p.householdB.organisation],
    [t("registeredAt"), (h) => <span className="num">{fmtDateTime(h.createdAt, locale)}</span>, false],
    [t("version"), (h) => <span className="num">{h.version}</span>, false],
  ];

  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={p.label === "Likely" ? "danger" : "pending"} className="num">
          {p.label === "Likely" ? t("likelyBadge") : t("possibleBadge")} · {p.score}
        </Badge>
        <StatusBadge status={p.status} locale={locale} />
        <span className="text-sm text-ink-muted">{match}</span>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b border-line">
            <th className="w-[26%] py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted" />
            <th className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("householdA")}</th>
            <th className="py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-muted">{t("householdB")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, render, differs]) => (
            <tr key={label} className={cn("border-b border-line last:border-b-0", differs && "bg-status-pending-bg")}>
              <td className="py-2 pr-2 text-ink-muted">{label}</td>
              <td className="py-2 pr-2 text-ink">{render(p.householdA)}</td>
              <td className="py-2 text-ink">{render(p.householdB)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.reviewedBy && <p className="text-sm text-ink-muted">{t("reviewedBy", { name: p.reviewedBy, time: fmtDateTime(p.reviewedAt, locale) })}</p>}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {p.status === "PendingReview" && (
          <>
            <Button onClick={() => setConfirmOpen(true)} disabled={busy || closed}>
              {t("confirmLink")}
            </Button>
            <Button variant="secondary" onClick={() => act("markNotDuplicate")} disabled={busy || closed}>
              {t("markNotDuplicate")}
            </Button>
          </>
        )}
        {p.status === "Linked" && (
          <Button variant="secondary" onClick={() => act("undoLink")} disabled={busy || closed}>
            {t("undoLink")}
          </Button>
        )}
      </div>
      {!confirmOpen && <ErrorText>{error}</ErrorText>}
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t("linkConfirmTitle")} body={t("linkConfirmBody")} confirmLabel={t("confirmLink")} busy={busy} error={error} onConfirm={() => act("confirmLink")} />
    </div>
  );
}

function FlagsTab({ initialId }: { initialId: string | null }) {
  const { t, locale, operation } = useDash();
  const [status, setStatus] = useState<Flag["status"]>("PendingReview");
  const { data, error, loading, reload } = useApi<{ flags: Flag[] }>(operation ? `/api/flags${qs({ status, operationId: operation.operationId })}` : null);
  const [selectedId, setSelectedId] = useState<string | null>(initialId);
  const flags = data?.flags ?? [];
  const selected = flags.find((f) => f.flagId === selectedId) ?? null;

  useEffect(() => {
    if (initialId) setSelectedId(initialId);
  }, [initialId]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        {t("status")}
        <NativeSelect value={status} onChange={(e) => { setStatus(e.target.value as Flag["status"]); setSelectedId(null); }}>
          {(["PendingReview", "Justified", "Repeat"] as const).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s][locale]}
            </option>
          ))}
        </NativeSelect>
      </label>
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {data && (
        <QueueLayout
          list={
            <>
              {flags.length === 0 && <li className="p-4 text-sm text-ink-muted">{t("flagsEmpty")}</li>}
              {flags.map((f) => (
                <li key={f.flagId} className="border-b border-line last:border-b-0">
                  <button type="button" onClick={() => setSelectedId(f.flagId)} className={cn("block w-full px-3 py-2.5 text-left hover:bg-canvas", f.flagId === selectedId && "bg-status-ok-bg")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="num text-sm font-semibold text-ink">{f.shortCode ?? "—"}</span>
                      <StatusBadge status={f.status} locale={locale} />
                    </span>
                    <span className="num block text-xs text-ink-muted">
                      {f.first.organisation} / {f.second.organisation} · {t("hoursApart", { h: f.hoursApart })}
                    </span>
                  </button>
                </li>
              ))}
            </>
          }
          detail={selected ? <FlagDetail key={selected.flagId} f={selected} onChanged={reload} /> : <p className="rounded-md border border-line bg-surface p-4 text-sm text-ink-muted">{t("selectFlag")}</p>}
        />
      )}
    </div>
  );
}

function FlagDetail({ f, onChanged }: { f: Flag; onChanged: () => void }) {
  const { t, locale } = useDash();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function review(status: "Justified" | "Repeat") {
    if (note.trim().length < 5) return setError(t("noteError"));
    setBusy(true);
    setError(null);
    try {
      await api(`/api/flags/${f.flagId}/review`, { body: { status, note: note.trim() } });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const column = (title: string, d: FlagDistribution) => (
    <div className="rounded-md border border-line p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</p>
        <StatusBadge status={d.status} locale={locale} />
      </div>
      <p className="text-base font-semibold text-ink">{d.organisation ?? "—"}</p>
      <p className="num text-sm text-ink">{fmtDateTime(d.distributedAt, locale)}</p>
      <p className="text-sm text-ink-muted">
        {t("recordedBy")}: {d.recordedBy}
      </p>
      <p className="text-sm text-ink-muted">{areaText(d.area, locale)}</p>
      <ul className="mt-2 space-y-0.5 text-sm">
        {d.items.map((i) => (
          <li key={i.itemId} className={cn("flex justify-between gap-2", f.sharedItems.includes(i.itemName) && "font-semibold text-status-danger-fg")}>
            <span>{i.itemName}</span>
            <span className="num">× {i.quantity}</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        {f.shortCode && (
          <Link href={`/dashboard/households?code=${f.shortCode}`} className="num text-lg font-semibold text-primary hover:underline">
            {f.shortCode}
          </Link>
        )}
        <span className="num text-sm text-ink">{t("hoursApart", { h: f.hoursApart })}</span>
        <span className="text-sm text-ink-muted">{t("sharedItems", { items: f.sharedItems.join(", ") })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {column(t("first"), f.first)}
        {column(t("second"), f.second)}
      </div>
      {f.status === "PendingReview" ? (
        <div className="space-y-2 border-t border-line pt-4">
          <label htmlFor="flag-note" className="block text-sm font-semibold text-ink">
            {t("note")}
          </label>
          <Textarea id="flag-note" rows={3} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} aria-invalid={!!error} />
          <p className="text-xs text-ink-muted">{t("noteHelp")}</p>
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button onClick={() => review("Justified")} disabled={busy}>
              {t("markJustified")}
            </Button>
            <Button variant="danger" onClick={() => review("Repeat")} disabled={busy}>
              {t("flagRepeat")}
            </Button>
          </div>
        </div>
      ) : (
        <Notice tone={f.status === "Justified" ? "ok" : "danger"}>
          {t("reviewedBy", { name: f.reviewedBy ?? "—", time: fmtDateTime(f.reviewedAt, locale) })}: {f.note}
        </Notice>
      )}
    </div>
  );
}
