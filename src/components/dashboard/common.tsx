"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDash } from "./dash-provider";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <h1 className="text-lg font-semibold text-ink">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm font-medium text-status-danger-fg">
      {children}
    </p>
  );
}

export function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry?: () => void }) {
  const { t } = useDash();
  if (error)
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-status-danger-fg bg-status-danger-bg px-3 py-2 text-sm text-status-danger-fg">
        <span>{t("errorLoading", { message: error })}</span>
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            {t("retry")}
          </Button>
        )}
      </div>
    );
  if (loading) return <p className="text-sm text-ink-muted">{t("loading")}</p>;
  return null;
}

export function Notice({ tone, children }: { tone: "ok" | "pending" | "danger" | "neutral"; children: ReactNode }) {
  const tones = {
    ok: "border-status-ok-fg bg-status-ok-bg text-status-ok-fg",
    pending: "border-status-pending-fg bg-status-pending-bg text-status-pending-fg",
    danger: "border-status-danger-fg bg-status-danger-bg text-status-danger-fg",
    neutral: "border-line bg-status-neutral-bg text-status-neutral-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-md border px-3 py-2 text-sm font-medium", tones[tone])}>
      {children}
    </div>
  );
}

export function Panel({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-md border border-line bg-surface", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Confirmation for irreversible state changes (CLAUDE.md §1). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  confirmDisabled,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  confirmDisabled?: boolean;
  error?: string | null;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const { t } = useDash();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        {children}
        {error && <ErrorText>{error}</ErrorText>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy || confirmDisabled}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Two-column key/value list used in comparison panes. */
export function KeyValues({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(120px,40%)_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-ink-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
