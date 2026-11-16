"use client";

import { ClipboardList, PackageCheck, RefreshCw, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dictionary";
import { Badge } from "@/components/ui/badge";
import { useField } from "./field-provider";
import { Banner, fmtTime } from "./field-ui";

export function FieldLocaleToggle() {
  const { locale, setLocale } = useField();
  const opts: { value: Locale; label: string }[] = [
    { value: "en", label: "EN" },
    { value: "bn", label: "বাংলা" },
  ];
  return (
    <div role="radiogroup" aria-label="Language / ভাষা" className="inline-flex h-10 shrink-0 overflow-hidden rounded-md border border-line bg-surface text-sm font-semibold">
      {opts.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={locale === o.value}
          onClick={() => setLocale(o.value)}
          className={cn("whitespace-nowrap px-2.5", i > 0 && "border-l border-line", o.value === "bn" && "font-bangla", locale === o.value ? "bg-primary text-primary-fg" : "text-ink-muted")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SimulatorSwitch() {
  const { t, sync } = useField();
  const on = sync.isOfflineSimulated;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => void sync.setOfflineSimulated(!on)}
      className="flex h-10 shrink-0 items-center gap-1.5 text-xs font-medium text-ink"
    >
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full border transition-colors", on ? "border-status-danger-fg bg-status-danger-fg" : "border-line-strong bg-status-neutral-bg")}>
        <span className={cn("absolute top-[2px] size-[18px] rounded-full bg-surface border border-line-strong", on ? "left-[18px]" : "left-[2px]")} />
      </span>
      <span className="whitespace-nowrap">{t("simulateOffline")}</span>
    </button>
  );
}

/**
 * Persistent top status bar, two rows at 360 px:
 *   connectivity · Pending: X · [Sync now]
 *   Last sync HH:MM · offline simulator · EN | বাংলা
 */
export function TopBar({ showSync }: { showSync: boolean }) {
  const { t, locale, sync } = useField();
  const statusText = sync.isOfflineSimulated ? t("offlineSimulated") : sync.isOnline ? t("online") : t("offline");
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface">
      <div className="mx-auto max-w-[480px] px-3">
        <div className="flex min-h-12 items-center gap-2 py-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-ink" aria-live="polite">
            <span className={cn("size-2.5 shrink-0 rounded-full", sync.isOnline ? "bg-status-ok-fg" : "bg-status-danger-fg")} aria-hidden />
            <span className="truncate">{statusText}</span>
          </span>
          {showSync && (
            <Badge tone={sync.pendingCount > 0 ? "pending" : "neutral"} className="num shrink-0">
              {t("pendingN", { n: sync.pendingCount })}
            </Badge>
          )}
          {showSync && (
            <button
              type="button"
              onClick={() => void sync.syncNow(true)}
              disabled={sync.syncing || !sync.isOnline}
              className="ml-auto flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-3 text-sm font-semibold text-primary-fg active:bg-primary-hover disabled:opacity-50"
            >
              <RefreshCw className={cn("size-4", sync.syncing && "animate-spin")} aria-hidden />
              {sync.syncing ? t("syncing") : t("syncNow")}
            </button>
          )}
        </div>
        <div className="flex min-h-11 items-center gap-2 border-t border-line py-0.5">
          {showSync && (
            <span className="num flex min-w-0 flex-1 text-xs text-ink-muted">
              {sync.lastSyncAt ? (
                <>
                  <span className="truncate">{t("lastSync", { time: "" }).trim()}</span>
                  <span className="ml-1 shrink-0 font-semibold text-ink">{fmtTime(sync.lastSyncAt, locale)}</span>
                </>
              ) : (
                <span className="truncate">{t("neverSynced")}</span>
              )}
            </span>
          )}
          <div className={cn("flex items-center gap-2", !showSync && "w-full justify-between")}>
            <SimulatorSwitch />
            <FieldLocaleToggle />
          </div>
        </div>
      </div>
    </header>
  );
}

/** FR23 local alerts. */
export function SyncAlerts() {
  const { t, sync, navigate, setReauthOpen } = useField();
  const o = sync.outcome;
  const failed = sync.failedCount + sync.rejectedCount;
  return (
    <div className="space-y-2 empty:hidden">
      {o?.status === "authRequired" && (
        <Banner
          tone="danger"
          action={
            <button type="button" onClick={() => setReauthOpen(true)} className="h-10 shrink-0 rounded-md bg-status-danger-fg px-3 text-sm font-semibold text-white">
              {t("signInAgain")}
            </button>
          }
        >
          {t("alertAuth")}
        </Banner>
      )}
      {o?.status === "blocked" && <Banner tone="danger">{t("alertBlocked", { message: o.message.replace(/\.$/, "") })}</Banner>}
      {o?.status === "error" && <Banner tone="danger">{t("alertError", { message: o.message.replace(/\.$/, "") })}</Banner>}
      {failed > 0 && (
        <Banner tone="danger">
          <button type="button" className="text-left underline underline-offset-2" onClick={() => navigate("/field/sync")}>
            {t("alertFailed", { n: failed })}
          </button>
        </Banner>
      )}
      {sync.waitingTooLong && <Banner tone="pending">{t("alertWaiting")}</Banner>}
    </div>
  );
}

const NAV = [
  { path: "/field/register", key: "navRegister", Icon: UserPlus },
  { path: "/field/distribute", key: "navDistribute", Icon: PackageCheck },
  { path: "/field/records", key: "navRecords", Icon: ClipboardList },
  { path: "/field/sync", key: "navSync", Icon: RefreshCw },
] as const;

/** Bottom thumb-zone navigation. */
export function BottomNav() {
  const { t, pathname, navigate, sync } = useField();
  return (
    <nav aria-label="Field" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto grid max-w-[480px] grid-cols-4">
        {NAV.map(({ path, key, Icon }) => {
          const active = pathname === path;
          const badge = path === "/field/sync" && sync.failedCount + sync.rejectedCount > 0;
          return (
            <li key={path}>
              <button
                type="button"
                onClick={() => navigate(path)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 border-t-[3px] text-xs font-semibold",
                  active ? "border-primary text-primary" : "border-transparent text-ink-muted",
                )}
              >
                <Icon className="size-6" aria-hidden />
                {t(key)}
                {badge && <span className="absolute right-5 top-2 size-2.5 rounded-full bg-status-danger-fg" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
