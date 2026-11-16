"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Bell, ClipboardList, Copy, FileText, History, LayoutGrid, LogOut, Map, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { NAV, canOpen, type DashSection } from "@/lib/dashboard-nav";
import { ROLE_LABELS } from "@/lib/i18n/dictionary";
import { api } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { LocaleToggle } from "@/components/locale-toggle";
import { StatusBadge } from "@/components/status-badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/native-select";
import { useDash } from "./dash-provider";

const ICONS: Record<DashSection, typeof Map> = {
  coverage: Map,
  conflicts: Copy,
  duplicates: LayoutGrid,
  households: History,
  operations: Settings,
  admin: ShieldCheck,
  audit: ClipboardList,
  reports: FileText,
};

type Notification = { notificationId: string; type: string; message: string; linkPath: string; isRead: boolean; createdAt: string };

function NotificationBell() {
  const { t, locale } = useDash();
  const router = useRouter();
  const { data, reload } = useApi<{ notifications: Notification[]; unreadCount: number }>("/api/notifications?limit=20");
  useEffect(() => {
    const id = setInterval(() => void reload(), 60_000);
    return () => clearInterval(id);
  }, [reload]);
  const unread = data?.unreadCount ?? 0;

  async function open(n: Notification) {
    if (!n.isRead) await api("/api/notifications", { method: "PATCH", body: { ids: [n.notificationId] } }).catch(() => undefined);
    await reload();
    router.push(n.linkPath);
  }

  return (
    <Popover>
      <PopoverTrigger className="relative flex size-9 items-center justify-center rounded-md border border-line bg-surface text-ink hover:bg-canvas" aria-label={`${t("notifications")} — ${t("unreadN", { n: unread })}`}>
        <Bell className="size-4" />
        {unread > 0 && <span className="num absolute -right-1.5 -top-1.5 min-w-5 rounded-sm bg-status-danger-fg px-1 text-center text-[11px] font-bold leading-5 text-white">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-sm font-semibold text-ink">
            {t("notifications")} <span className="num font-normal text-ink-muted">· {t("unreadN", { n: unread })}</span>
          </span>
          {unread > 0 && (
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
              onClick={async () => {
                await api("/api/notifications", { method: "PATCH", body: { all: true } }).catch(() => undefined);
                await reload();
              }}
            >
              {t("markAllRead")}
            </button>
          )}
        </div>
        <ul className="max-h-[420px] overflow-y-auto">
          {(data?.notifications ?? []).length === 0 && <li className="px-3 py-3 text-sm text-ink-muted">{t("noNotifications")}</li>}
          {(data?.notifications ?? []).map((n) => (
            <li key={n.notificationId} className="border-b border-line last:border-b-0">
              <button type="button" onClick={() => open(n)} className="flex w-full gap-2 px-3 py-2 text-left hover:bg-canvas">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.isRead ? "bg-transparent" : "bg-primary")} aria-hidden />
                <span className="min-w-0">
                  <span className={cn("block text-sm text-ink", !n.isRead && "font-semibold")}>{n.message}</span>
                  <span className="num block text-xs text-ink-muted">{fmtDateTime(n.createdAt, locale)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const { t, locale, user, operations, operation, setOperationId } = useDash();
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await api("/api/auth/logout", { body: {} }).catch(() => undefined);
    router.push("/login");
    router.refresh();
  }

  return (
    <div className={cn("min-h-dvh bg-canvas", locale === "bn" && "font-bangla")}>
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[230px] flex-col border-r border-line bg-surface print:hidden">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            {t("appName")}
          </Link>
        </div>
        <nav className="flex-1 overflow-y-auto py-2" aria-label="Dashboard">
          <ul>
            {NAV.filter((n) => canOpen(user.role, n.section)).map((n) => {
              const Icon = ICONS[n.section];
              const active = pathname.startsWith(n.href);
              return (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "mx-2 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm",
                      active ? "bg-status-ok-bg font-semibold text-primary" : "text-ink-muted hover:bg-canvas hover:text-ink",
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden />
                    {t(n.label)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-line p-3 text-xs">
          <p className="truncate font-semibold text-ink">{user.fullName}</p>
          <p className="truncate text-ink-muted">{ROLE_LABELS[user.role][locale]}</p>
          {user.organisationName && <p className="truncate text-ink-muted">{user.organisationName}</p>}
          <button type="button" onClick={signOut} className="mt-2 flex h-8 items-center gap-1.5 font-semibold text-ink-muted hover:text-ink">
            <LogOut className="size-3.5" aria-hidden /> {t("signOut")}
          </button>
        </div>
      </aside>

      <header className="fixed left-[230px] right-0 top-0 z-10 flex h-14 items-center gap-3 border-b border-line bg-surface px-5 print:hidden">
        <label htmlFor="op-select" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t("operation")}
        </label>
        {operations.length === 0 ? (
          <span className="text-sm text-ink-muted">{t("noOperations")}</span>
        ) : (
          <NativeSelect id="op-select" value={operation?.operationId ?? ""} onChange={(e) => setOperationId(e.target.value)} className="max-w-[360px]">
            {operations.map((o) => (
              <option key={o.operationId} value={o.operationId}>
                {o.name}
                {o.status === "Closed" ? ` (${o.status})` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
        {operation && <StatusBadge status={operation.status} locale={locale} />}
        <div className="ml-auto flex items-center gap-3">
          <NotificationBell />
          <LocaleToggle locale={locale} ariaLabel="Language / ভাষা" />
          <span className="hidden items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs xl:flex">
            <span className="font-semibold text-ink">{user.fullName}</span>
            <span className="text-ink-muted">· {user.organisationName ?? ROLE_LABELS[user.role][locale]}</span>
          </span>
        </div>
      </header>

      <main className="ml-[230px] px-6 pb-10 pt-[76px] print:m-0 print:p-0">{children}</main>
    </div>
  );
}
