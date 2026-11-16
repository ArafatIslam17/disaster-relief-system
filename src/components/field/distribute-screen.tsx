"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { displayCode, recordDistribution, type DecryptedHousehold } from "@/lib/field/repo";
import type { LocalDistribution } from "@/lib/offline-db";
import { StatusBadge } from "@/components/status-badge";
import { useField } from "./field-provider";
import { areaLabel, Banner, BigButton, dhakaDay, fmtDateTime, ScreenTitle, Stepper } from "./field-ui";

const MAX_RESULTS = 20;

/** Matches short/temporary code, head name, or (unmasked) mobile digits. */
export function matchHousehold(h: DecryptedHousehold, q: string) {
  const query = q.trim().toLowerCase();
  if (query.length < 2) return false;
  const digits = query.replace(/\D/g, "");
  return (
    (h.shortCode ?? "").toLowerCase().includes(query) ||
    (h.provisionalCode ?? "").toLowerCase().includes(query) ||
    h.headName.toLowerCase().includes(query) ||
    (!h.mobileMasked && digits.length >= 3 && (h.mobileNumber ?? "").includes(digits))
  );
}

/** UC-13 / Sequence Diagram 02, with UC-21 unserved quick-select. */
export function DistributeScreen() {
  const { t, locale, households, householdsById, areas, areasById, items, distributions, unservedLists, session, intent, setIntent, sync } = useField();
  const downloaded = useMemo(() => areas.filter((a) => a.downloaded === 1), [areas]);
  const [tab, setTab] = useState<"search" | "unserved">("search");
  const [anonymous, setAnonymous] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anonArea, setAnonArea] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hand-off from Register (selected existing / just registered / consent declined).
  useEffect(() => {
    if (!intent) return;
    if (intent.distributeHouseholdId) {
      setSelectedId(intent.distributeHouseholdId);
      setAnonymous(false);
    }
    if (intent.anonymous) {
      setAnonymous(true);
      setSelectedId(null);
    }
    setSaved(false);
    setIntent(null);
  }, [intent, setIntent]);

  const results = useMemo(() => (query.trim().length >= 2 ? households.filter((h) => matchHousehold(h, query)).slice(0, MAX_RESULTS) : []), [households, query]);

  const servedIds = useMemo(() => new Set(distributions.filter((d) => d.status === "Active" && d.householdId).map((d) => d.householdId!)), [distributions]);
  const unserved = useMemo(() => {
    const downloadedIds = new Set(downloaded.map((a) => a.areaId));
    return [...unservedLists]
      .filter((r) => downloadedIds.has(r.areaId))
      .sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))
      .map((r) => ({ release: r, households: r.householdIds.filter((id) => !servedIds.has(id)).map((id) => householdsById.get(id)).filter((h): h is DecryptedHousehold => !!h) }));
  }, [unservedLists, downloaded, servedIds, householdsById]);

  const selected = selectedId ? householdsById.get(selectedId) : undefined;
  const history = useMemo<LocalDistribution[]>(() => (selectedId ? distributions.filter((d) => d.householdId === selectedId) : []), [distributions, selectedId]);
  const today = dhakaDay(Date.now());
  const servedToday = history.some((d) => d.status === "Active" && dhakaDay(d.distributedAt) === today);

  const chosenItems = items.filter((i) => (qty[i.itemId] ?? 0) > 0).map((i) => ({ itemId: i.itemId, quantity: qty[i.itemId] }));
  const areaId = anonymous ? anonArea || (downloaded.length === 1 ? downloaded[0].areaId : "") : selected?.areaId;
  const canConfirm = !!session && chosenItems.length > 0 && !!areaId && (anonymous || !!selected);

  function resetAll() {
    setSelectedId(null);
    setQty({});
    setQuery("");
    setSaved(false);
    setError(null);
  }

  async function confirm() {
    if (!canConfirm || !session || !areaId) return;
    setSaving(true);
    setError(null);
    try {
      await recordDistribution(session, { householdId: anonymous ? null : selected!.householdId, areaId, items: chosenItems });
      setSaved(true);
      setQty({});
      sync.requestSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const itemName = (id: string) => items.find((i) => i.itemId === id)?.itemName ?? id;

  if (saved) {
    return (
      <section className="space-y-4">
        <ScreenTitle>{t("distributeTitle")}</ScreenTitle>
        <Banner tone="ok">{t("distributionSaved")}</Banner>
        {selected && (
          <p className="num text-base font-semibold text-ink">
            {displayCode(selected)} · {selected.headName}
          </p>
        )}
        <BigButton onClick={resetAll}>{t("recordAnother")}</BigButton>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <ScreenTitle>{t("distributeTitle")}</ScreenTitle>

      <label className="flex min-h-[52px] items-center justify-between gap-3 rounded-md border border-line bg-surface px-3">
        <span>
          <span className="block text-base font-semibold text-ink">{t("anonymousToggle")}</span>
          <span className="block text-sm text-ink-muted">{t("anonymousHint")}</span>
        </span>
        <input
          type="checkbox"
          className="size-6 shrink-0 accent-[var(--color-primary)]"
          checked={anonymous}
          onChange={(e) => {
            setAnonymous(e.target.checked);
            setSelectedId(null);
          }}
        />
      </label>

      {anonymous ? (
        <div>
          <label htmlFor="anon-area" className="mb-1 block text-sm font-semibold text-ink">
            {t("ward")}
          </label>
          {downloaded.length === 0 ? (
            <Banner tone="pending">{t("noWards")}</Banner>
          ) : (
            <select id="anon-area" value={areaId ?? ""} onChange={(e) => setAnonArea(e.target.value)} className="h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink">
              <option value="">{t("chooseWard")}</option>
              {downloaded.map((a) => (
                <option key={a.areaId} value={a.areaId}>
                  {areaLabel(a, locale, t)}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : selected ? (
        <div className="space-y-3">
          <div className="rounded-md border-2 border-primary bg-surface p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="num text-2xl font-bold text-ink">{displayCode(selected)}</p>
                <p className="truncate text-base font-semibold text-ink">{selected.headName}</p>
                <p className="num text-sm text-ink-muted">
                  {selected.mobileNumber ?? "—"} · {t("membersShort", { n: selected.memberCount })} · {areaLabel(areasById.get(selected.areaId), locale, t)}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedId(null)} className="h-10 shrink-0 rounded-md border border-line px-3 text-sm font-semibold text-ink">
                {t("change")}
              </button>
            </div>
          </div>
          {servedToday && <Banner tone="danger">{t("servedToday")}</Banner>}
          <div className="rounded-md border border-line bg-surface">
            <p className="border-b border-line px-3 py-2 text-sm font-semibold text-ink">{history.length ? t("historyTitle", { n: history.length }) : t("historyNone")}</p>
            <ul>
              {history.slice(0, 5).map((d) => (
                <li key={d.distributionId} className="flex items-start justify-between gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0">
                  <div className="min-w-0">
                    <p className="num font-medium text-ink">{fmtDateTime(d.distributedAt, locale)}</p>
                    <p className="truncate text-ink-muted">{d.items.map((i) => `${itemName(i.itemId)} × ${i.quantity}`).join(", ")}</p>
                    <p className="text-ink-muted">{d.recordedByOrganisationId === session?.organisationId ? t("byYourOrg") : t("byOtherOrg")}</p>
                  </div>
                  <StatusBadge status={d.status} locale={locale} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div role="tablist" className="grid grid-cols-2 rounded-md border border-line bg-surface p-1">
            {(["search", "unserved"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                type="button"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn("h-11 rounded-sm text-sm font-semibold", tab === k ? "bg-primary text-primary-fg" : "text-ink-muted")}
              >
                {k === "search" ? t("tabSearch") : t("tabUnserved")}
              </button>
            ))}
          </div>

          {tab === "search" ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  aria-label={t("searchPlaceholder")}
                  className="h-12 w-full rounded-md border border-line bg-surface pl-10 pr-3 text-base text-ink placeholder:text-ink-faint focus-visible:border-primary focus-visible:outline-none"
                  autoComplete="off"
                />
              </div>
              {query.trim().length < 2 ? (
                <p className="text-sm text-ink-muted">{t("typeToSearch")}</p>
              ) : results.length === 0 ? (
                <p className="text-sm text-ink-muted">{t("noResults")}</p>
              ) : (
                <HouseholdList households={results} onSelect={setSelectedId} />
              )}
            </div>
          ) : unserved.length === 0 ? (
            <p className="text-sm text-ink-muted">{t("unservedEmpty")}</p>
          ) : (
            unserved.map(({ release, households: hs }) => (
              <div key={release.releaseId} className="space-y-2">
                <p className="num text-sm font-semibold text-ink">
                  {areaLabel(areasById.get(release.areaId), locale, t)} · {t("releasedAt", { time: fmtDateTime(release.releasedAt, locale) })}
                </p>
                {hs.length ? <HouseholdList households={hs} onSelect={setSelectedId} /> : <p className="text-sm text-ink-muted">{t("unservedEmpty")}</p>}
              </div>
            ))
          )}
        </div>
      )}

      {(anonymous || selected) && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-ink">{t("items")}</h2>
          {items.length === 0 ? (
            <Banner tone="pending">{t("noItems")}</Banner>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line bg-surface">
              {items.map((i) => (
                <li key={i.itemId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-base text-ink">
                    {i.itemName}
                    <span className="block text-xs text-ink-muted">{i.unit}</span>
                  </span>
                  <Stepper value={qty[i.itemId] ?? 0} onChange={(v) => setQty((q) => ({ ...q, [i.itemId]: v }))} min={0} max={50} label={i.itemName} t={t} />
                </li>
              ))}
            </ul>
          )}
          {error && <Banner tone="danger">{error}</Banner>}
          <BigButton onClick={confirm} disabled={!canConfirm || saving} className="min-h-14 text-lg">
            {saving ? t("saving") : t("confirmDistribution")}
          </BigButton>
        </div>
      )}
    </section>
  );
}

function HouseholdList({ households, onSelect }: { households: DecryptedHousehold[]; onSelect: (id: string) => void }) {
  const { t, locale, areasById } = useField();
  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-surface">
      {households.map((h) => (
        <li key={h.householdId}>
          <button type="button" onClick={() => onSelect(h.householdId)} className="flex min-h-[60px] w-full items-center justify-between gap-2 px-3 py-2 text-left active:bg-canvas">
            <span className="min-w-0">
              <span className="num block text-base font-bold text-ink">{displayCode(h)}</span>
              <span className="block truncate text-sm text-ink">{h.headName}</span>
              <span className="num block text-xs text-ink-muted">
                {h.mobileNumber ?? "—"} · {t("membersShort", { n: h.memberCount })} · {areaLabel(areasById.get(h.areaId), locale, t)}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-primary">{t("select")}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
