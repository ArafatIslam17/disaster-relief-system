"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Lock, LogOut } from "lucide-react";
import { placeName } from "@/lib/i18n/dictionary";
import { fieldDb, unsyncedCount, wipeLocalData, type OutboxEvent } from "@/lib/offline-db";
import { ApiFailure, fieldFetch, OfflineError } from "@/lib/field/api";
import { discardRejectedEvent, displayCode } from "@/lib/field/repo";
import { downloadArea, markNotificationsRead, pullReferenceData, removeArea } from "@/lib/field/sync";
import { lockVault } from "@/lib/field/vault";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useField } from "./field-provider";
import { Banner, BigButton, fmtDateTime, ScreenTitle } from "./field-ui";

const KIND = { register: "kindRegister", edit: "kindEdit", distribute: "kindDistribute", void: "kindVoid" } as const;

/** UC-10 offline data packs, UC-16 sync queue, UC-20 notifications. */
export function SyncScreen() {
  const { t, locale, areas, session, sync, lock, setPhase } = useField();
  const [busyArea, setBusyArea] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discardId, setDiscardId] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const householdCounts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    for (const h of await fieldDb().households.toArray()) m.set(h.areaId, (m.get(h.areaId) ?? 0) + 1);
    return m;
  }, []);
  const outbox = useLiveQuery(() => fieldDb().outboxEvents.orderBy("seq").reverse().limit(100).toArray(), []) ?? [];
  const codes = useLiveQuery(async () => {
    const m = new Map<string, string>();
    for (const h of await fieldDb().households.toArray()) m.set(h.householdId, displayCode(h));
    return m;
  }, []);
  const notifications = useLiveQuery(() => fieldDb().notifications.orderBy("createdAt").reverse().toArray(), []) ?? [];

  const groups = useMemo(() => {
    const g = new Map<string, typeof areas>();
    for (const a of areas) {
      const k = `${a.upazila}|${a.unionName}`;
      g.set(k, [...(g.get(k) ?? []), a]);
    }
    return [...g.entries()];
  }, [areas]);

  const describe = (err: unknown) => (err instanceof OfflineError ? t("needNetwork") : err instanceof Error ? err.message : String(err));

  async function toggleArea(areaId: string, downloaded: boolean) {
    setError(null);
    setBusyArea(areaId);
    try {
      if (downloaded) {
        const pending = await fieldDb().outboxEvents.where("state").anyOf("Pending", "Uploading", "Failed").toArray();
        const areaEntities = new Set([
          ...(await fieldDb().households.where("areaId").equals(areaId).primaryKeys()),
          ...(await fieldDb().distributions.where("areaId").equals(areaId).primaryKeys()),
        ]);
        if (pending.some((e) => areaEntities.has(e.entityId))) throw new Error(t("removeAreaBlocked"));
        await removeArea(areaId);
      } else {
        await downloadArea(areaId);
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusyArea(null);
    }
  }

  async function signOut() {
    setSignOutError(null);
    if ((await unsyncedCount()) > 0) return setSignOutError(t("signOutBlocked"));
    await fieldFetch("/api/auth/logout", { body: {} }).catch(() => undefined);
    await wipeLocalData();
    lockVault();
    setPhase("signedOut");
  }

  const failedCount = sync.failedCount;

  return (
    <section className="space-y-6">
      <ScreenTitle>{t("syncTitle")}</ScreenTitle>

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">{t("dataPacks")}</h2>
            <p className="text-sm text-ink-muted">{t("dataPacksHint")}</p>
          </div>
        </div>
        <BigButton variant="secondary" onClick={() => pullReferenceData().catch((err) => setError(describe(err)))} disabled={!sync.isOnline}>
          {t("refreshAreas")}
        </BigButton>
        {error && <Banner tone="danger">{error}</Banner>}
        {areas.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noAreas")}</p>
        ) : (
          groups.map(([key, list]) => (
            <div key={key} className="rounded-md border border-line bg-surface">
              <p className={`border-b border-line bg-canvas px-3 py-2 text-sm font-semibold text-ink ${locale === "bn" ? "font-bangla" : ""}`}>
                {placeName(list[0].upazila, locale)} › {placeName(list[0].unionName, locale)}
              </p>
              <ul className="divide-y divide-line">
                {list.map((a) => (
                  <li key={a.areaId} className="flex items-center justify-between gap-2 px-3 py-2">
                    <div className="min-w-0">
                      <p className="num text-base font-semibold text-ink">
                        {t("ward")} {a.ward}
                      </p>
                      <p className="num text-xs text-ink-muted">
                        {a.downloaded ? t("downloadedInfo", { n: householdCounts?.get(a.areaId) ?? 0, time: a.downloadedAt ? fmtDateTime(a.downloadedAt, locale) : "" }) : t("notDownloaded")}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busyArea !== null || (!a.downloaded && !sync.isOnline)}
                      onClick={() => toggleArea(a.areaId, a.downloaded === 1)}
                      className={`h-11 min-w-[104px] shrink-0 rounded-md border px-3 text-sm font-semibold disabled:opacity-50 ${a.downloaded ? "border-line bg-surface text-ink" : "border-primary bg-primary text-primary-fg"}`}
                    >
                      {busyArea === a.areaId ? t("downloading") : a.downloaded ? t("remove") : t("download")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("outbox")}</h2>
          {failedCount > 0 && (
            <Button variant="secondary" size="sm" className="h-10" onClick={() => void sync.syncNow(true)} disabled={!sync.isOnline || sync.syncing}>
              {t("retryFailed")}
            </Button>
          )}
        </div>
        {outbox.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("outboxEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface" data-testid="outbox">
            {outbox.map((e) => (
              <OutboxRow key={e.eventId} e={e} code={e.summary.householdId ? codes?.get(e.summary.householdId) : undefined} onDiscard={() => setDiscardId(e.eventId)} />
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("notifications")}</h2>
          {notifications.some((n) => !n.isRead) && (
            <Button variant="secondary" size="sm" className="h-10" disabled={!sync.isOnline} onClick={() => markNotificationsRead().catch((err) => setError(err instanceof ApiFailure ? err.message : describe(err)))}>
              {t("markAllRead")}
            </Button>
          )}
        </div>
        {!sync.isOnline && notifications.length > 0 && <p className="text-xs text-ink-muted">{t("notificationsCached")}</p>}
        {notifications.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("notificationsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {notifications.map((n) => (
              <li key={n.notificationId} className="px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-ink">{n.message}</p>
                  {!n.isRead && <Badge tone="pending">{t("unread")}</Badge>}
                </div>
                <p className="num text-xs text-ink-muted">{fmtDateTime(n.createdAt, locale)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {session && (
        <div className="space-y-3">
          <h2 className="text-base font-semibold text-ink">{t("account")}</h2>
          <div className="rounded-md border border-line bg-surface px-3 py-2 text-sm">
            <p className="font-semibold text-ink">{t("signedInAs", { name: session.fullName })}</p>
            <p className="text-ink-muted">{session.organisationName}</p>
            <p className="text-ink-muted">{session.operationName}</p>
            <p className="num text-ink-muted">{t("pinValidUntil", { time: fmtDateTime(session.pinExpiresAt, locale) })}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <BigButton variant="secondary" onClick={lock}>
              <Lock aria-hidden /> {t("lockApp")}
            </BigButton>
            <BigButton variant="secondary" onClick={signOut}>
              <LogOut aria-hidden /> {t("signOut")}
            </BigButton>
          </div>
          {signOutError && <Banner tone="danger">{signOutError}</Banner>}
        </div>
      )}

      <Dialog open={discardId !== null} onOpenChange={(o) => !o && setDiscardId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("discardEventTitle")}</DialogTitle>
            <DialogDescription>{t("discardEventBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="lg" onClick={() => setDiscardId(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              size="lg"
              onClick={async () => {
                if (discardId) await discardRejectedEvent(discardId);
                setDiscardId(null);
              }}
            >
              {t("discardEvent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function OutboxRow({ e, code, onDiscard }: { e: OutboxEvent; code?: string; onDiscard: () => void }) {
  const { t, locale } = useField();
  return (
    <li className="px-3 py-2" data-state={e.state}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {t(KIND[e.summary.kind])} {code && <span className="num">· {code}</span>}
          </p>
          <p className="num text-xs text-ink-muted">
            {fmtDateTime(e.createdAt, locale)}
            {e.attempts > 0 && ` · ${t("attempts", { n: e.attempts })}`}
            {e.state === "Failed" && ` · ${t("nextRetry", { time: fmtDateTime(e.nextAttemptAt, locale) })}`}
          </p>
        </div>
        <StatusBadge status={e.state} locale={locale} />
      </div>
      {e.lastError && e.state !== "Acknowledged" && <p className="mt-1 text-sm text-status-danger-fg">{e.lastError.message}</p>}
      {e.state === "Rejected" && (
        <button type="button" onClick={onDiscard} className="mt-1 h-10 text-sm font-semibold text-status-danger-fg underline underline-offset-2">
          {t("discardEvent")}
        </button>
      )}
    </li>
  );
}
