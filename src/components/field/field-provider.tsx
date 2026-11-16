"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { fieldDb, type AuthSession, type LocalArea, type LocalDistribution, type LocalReliefItem, type UnservedList } from "@/lib/offline-db";
import { fieldTranslator, isLocale, LOCALE_COOKIE, type FieldKey, type Locale } from "@/lib/i18n/dictionary";
import { decryptHousehold, type DecryptedHousehold } from "@/lib/field/repo";
import { getSession, isUnlocked, lockVault } from "@/lib/field/vault";
import { useSyncEngine, type SyncEngine } from "@/hooks/useSyncEngine";

/** loading → signedOut | locked | reauth → (login) → setPin → ready */
export type Phase = "loading" | "signedOut" | "locked" | "reauth" | "ready";

/** Transient hand-off between screens (e.g. "record a distribution for this household"). */
export type Intent = { distributeHouseholdId?: string; anonymous?: boolean } | null;

type FieldContext = {
  phase: Phase;
  setPhase: (p: Phase) => void;
  session: AuthSession | undefined;
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: FieldKey, vars?: Record<string, string | number>) => string;
  pathname: string;
  navigate: (path: string) => void;
  intent: Intent;
  setIntent: (i: Intent) => void;
  households: DecryptedHousehold[];
  householdsById: Map<string, DecryptedHousehold>;
  householdsReady: boolean;
  areas: LocalArea[];
  areasById: Map<string, LocalArea>;
  items: LocalReliefItem[];
  distributions: LocalDistribution[];
  unservedLists: UnservedList[];
  sync: SyncEngine;
  reauthOpen: boolean;
  setReauthOpen: (v: boolean) => void;
  lock: () => void;
};

const Ctx = createContext<FieldContext | null>(null);

export function useField(): FieldContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useField must be used inside <FieldProvider>");
  return v;
}

const IDLE_LOCK_MS = 10 * 60_000;
const NO_AREAS: LocalArea[] = [];
const NO_ITEMS: LocalReliefItem[] = [];
const NO_DISTRIBUTIONS: LocalDistribution[] = [];
const NO_LISTS: UnservedList[] = [];

export function FieldProvider({ initialLocale, children }: { initialLocale: Locale; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [intent, setIntent] = useState<Intent>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const pathname = usePathname() ?? "/field";
  const ready = phase === "ready";

  // Locale works offline: cookie for the next server render, state for this one.
  useEffect(() => {
    const m = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]+)`));
    if (m && isLocale(m[1])) setLocaleState(m[1]);
  }, []);
  const setLocale = useCallback((l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    setLocaleState(l);
  }, []);
  const t = useMemo(() => fieldTranslator(locale), [locale]);

  /** Client-side navigation that never touches the server, so it works with no network. */
  const navigate = useCallback((path: string) => {
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    window.scrollTo(0, 0);
  }, []);

  const session = useLiveQuery(() => fieldDb().authSession.get("current"), []);

  // Initial phase from the stored session.
  useEffect(() => {
    (async () => {
      const s = await getSession();
      if (!s) setPhase("signedOut");
      else if (s.lockedOut || Date.now() > s.pinExpiresAt) setPhase("reauth");
      else setPhase(isUnlocked() ? "ready" : "locked");
    })();
  }, []);

  const lock = useCallback(() => {
    lockVault();
    setPhase("locked");
  }, []);

  // Auto-lock after 10 minutes in the background.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current && Date.now() - hiddenAt.current > IDLE_LOCK_MS && isUnlocked()) lock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [lock]);

  // Non-PII tables straight from IndexedDB.
  const areas = useLiveQuery(() => (ready ? fieldDb().areas.toArray() : []), [ready]) ?? NO_AREAS;
  const items = useLiveQuery(() => (ready ? fieldDb().reliefItems.orderBy("itemId").toArray() : []), [ready]) ?? NO_ITEMS;
  const distributions = useLiveQuery(() => (ready ? fieldDb().distributions.orderBy("distributedAt").reverse().toArray() : []), [ready]) ?? NO_DISTRIBUTIONS;
  const unservedLists = useLiveQuery(() => (ready ? fieldDb().unservedLists.toArray() : []), [ready]) ?? NO_LISTS;
  const sortedAreas = useMemo(
    () => [...areas].sort((a, b) => `${a.upazila}|${a.unionName}|${a.ward}`.localeCompare(`${b.upazila}|${b.unionName}|${b.ward}`)),
    [areas],
  );
  const sortedItems = useMemo(() => [...items].sort((a, b) => a.itemName.localeCompare(b.itemName)), [items]);
  const areasById = useMemo(() => new Map(areas.map((a) => [a.areaId, a])), [areas]);

  // Household PII is decrypted into memory only while unlocked; decrypted rows are cached per revision.
  const rawHouseholds = useLiveQuery(() => (ready ? fieldDb().households.toArray() : []), [ready]);
  const cache = useRef(new Map<string, DecryptedHousehold>());
  const [households, setHouseholds] = useState<DecryptedHousehold[]>([]);
  const [householdsReady, setHouseholdsReady] = useState(false);
  useEffect(() => {
    if (!ready) {
      cache.current.clear();
      setHouseholds([]);
      setHouseholdsReady(false);
      return;
    }
    if (!rawHouseholds) return;
    let cancelled = false;
    (async () => {
      const next = new Map<string, DecryptedHousehold>();
      const out: DecryptedHousehold[] = [];
      for (const h of rawHouseholds) {
        const key = `${h.householdId}:${h.localUpdatedAt}`;
        const d = cache.current.get(key) ?? (await decryptHousehold(h));
        next.set(key, d);
        out.push(d);
      }
      if (cancelled) return;
      cache.current = next;
      out.sort((a, b) => (a.shortCode ?? a.provisionalCode ?? "").localeCompare(b.shortCode ?? b.provisionalCode ?? ""));
      setHouseholds(out);
      setHouseholdsReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [rawHouseholds, ready]);
  const householdsById = useMemo(() => new Map(households.map((h) => [h.householdId, h])), [households]);

  const sync = useSyncEngine(ready);

  // A 401 from sync means the server session expired: offer an in-place sign-in.
  useEffect(() => {
    if (sync.outcome?.status === "authRequired") setReauthOpen(true);
  }, [sync.outcome]);

  const value: FieldContext = {
    phase,
    setPhase,
    session,
    locale,
    setLocale,
    t,
    pathname,
    navigate,
    intent,
    setIntent,
    households,
    householdsById,
    householdsReady,
    areas: sortedAreas,
    areasById,
    items: sortedItems,
    distributions,
    unservedLists,
    sync,
    reauthOpen,
    setReauthOpen,
    lock,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
