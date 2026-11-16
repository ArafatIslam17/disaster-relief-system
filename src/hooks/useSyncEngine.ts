"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { fieldDb, getMeta, setMeta } from "@/lib/offline-db";
import { setSimulatedOffline } from "@/lib/field/api";
import { runSync, type SyncOutcome } from "@/lib/field/sync";

export const WAITING_TOO_LONG_MS = 6 * 3600_000;
const AUTO_SYNC_INTERVAL_MS = 60_000;
const PULL_INTERVAL_MS = 5 * 60_000;
const REQUEST_DEBOUNCE_MS = 1_500;

type Counts = { pendingCount: number; failedCount: number; rejectedCount: number; oldestPendingAt: number | null };
const EMPTY: Counts = { pendingCount: 0, failedCount: 0, rejectedCount: 0, oldestPendingAt: null };

export type SyncEngine = ReturnType<typeof useSyncEngine>;

/**
 * Resumable batch sync engine (Sequence Diagram 03, State Diagram 01).
 * Syncs automatically when the network returns, every minute while records are waiting, every
 * five minutes to pull updates, and shortly after anything is queued. Raises FR23 alerts for
 * failed records and records waiting longer than 6 hours.
 */
export function useSyncEngine(enabled: boolean) {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOfflineSimulated = useLiveQuery(() => getMeta<boolean>("simulateOffline", false), [], false);
  const lastSyncAt = useLiveQuery(() => getMeta<number | null>("lastSyncAt", null), [], null);
  const lastSyncError = useLiveQuery(() => getMeta<string | null>("lastSyncError", null), [], null);
  const counts =
    useLiveQuery(async () => {
      const all = await fieldDb().outboxEvents.toArray();
      const waiting = all.filter((e) => e.state === "Pending" || e.state === "Uploading" || e.state === "Failed");
      return {
        pendingCount: all.filter((e) => e.state === "Pending" || e.state === "Uploading").length,
        failedCount: all.filter((e) => e.state === "Failed").length,
        rejectedCount: all.filter((e) => e.state === "Rejected").length,
        oldestPendingAt: waiting.length ? Math.min(...waiting.map((e) => e.createdAt)) : null,
      } satisfies Counts;
    }, []) ?? EMPTY;

  useEffect(() => {
    setSimulatedOffline(isOfflineSimulated);
  }, [isOfflineSimulated]);

  useEffect(() => {
    setBrowserOnline(navigator.onLine);
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      clearInterval(tick);
    };
  }, []);

  const isOnline = browserOnline && !isOfflineSimulated;

  const syncNow = useCallback(
    async (force = true) => {
      if (!enabled) return;
      if (!isOnline) {
        setOutcome({ status: "offline" });
        return;
      }
      setSyncing(true);
      try {
        setOutcome(await runSync({ force }));
      } catch (err) {
        setOutcome({ status: "error", message: err instanceof Error ? err.message : "Sync failed" });
      } finally {
        setSyncing(false);
      }
    },
    [enabled, isOnline],
  );

  /** Call after queuing a record: syncs soon, without blocking the volunteer. */
  const requestSync = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void syncNow(false), REQUEST_DEBOUNCE_MS);
  }, [syncNow]);

  // Network came back (or simulator switched off): sync straight away.
  useEffect(() => {
    if (enabled && isOnline) void syncNow(false);
  }, [enabled, isOnline, syncNow]);

  // Periodic: every minute while records wait, every five minutes otherwise (pull updates).
  useEffect(() => {
    if (!enabled || !isOnline) return;
    const id = setInterval(() => {
      const due = counts.pendingCount + counts.failedCount > 0 || !lastSyncAt || Date.now() - lastSyncAt > PULL_INTERVAL_MS;
      if (due) void syncNow(false);
    }, AUTO_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, isOnline, counts.pendingCount, counts.failedCount, lastSyncAt, syncNow]);

  const setOfflineSimulated = useCallback(async (value: boolean) => {
    setSimulatedOffline(value);
    await setMeta("simulateOffline", value);
  }, []);

  const waitingTooLong = counts.oldestPendingAt !== null && now - counts.oldestPendingAt > WAITING_TOO_LONG_MS;

  return {
    isOnline,
    browserOnline,
    isOfflineSimulated,
    setOfflineSimulated,
    syncing,
    outcome,
    lastSyncAt,
    lastSyncError,
    waitingTooLong,
    syncNow,
    requestSync,
    ...counts,
  };
}
