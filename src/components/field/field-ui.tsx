"use client";

import { useState, type ReactNode } from "react";
import { Delete, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { placeName, type FieldKey, type Locale } from "@/lib/i18n/dictionary";
import type { LocalArea } from "@/lib/offline-db";

type T = (key: FieldKey, vars?: Record<string, string | number>) => string;

const tz = "Asia/Dhaka";

export function fmtTime(value: string | number | Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(value));
}

export function fmtDateTime(value: string | number | Date, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "bn" ? "bn-BD-u-nu-latn" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(value));
}

/** Calendar day in Asia/Dhaka, for "already served today". */
export function dhakaDay(value: string | number | Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

export function areaLabel(area: LocalArea | undefined, locale: Locale, t: T) {
  if (!area) return "—";
  return t("wardLabel", { union: placeName(area.unionName, locale), ward: area.ward });
}

export function ScreenTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold text-ink">{children}</h1>
      {sub && <p className="text-sm text-ink-muted">{sub}</p>}
    </div>
  );
}

export function Banner({ tone, children, action }: { tone: "danger" | "pending" | "ok" | "neutral"; children: ReactNode; action?: ReactNode }) {
  const tones = {
    danger: "border-status-danger-fg bg-status-danger-bg text-status-danger-fg",
    pending: "border-status-pending-fg bg-status-pending-bg text-status-pending-fg",
    ok: "border-status-ok-fg bg-status-ok-bg text-status-ok-fg",
    neutral: "border-line bg-status-neutral-bg text-status-neutral-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm font-medium", tones[tone])}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-medium text-status-danger-fg">
      {children}
    </p>
  );
}

/** Large +/- stepper for one-handed use. */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  label,
  t,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label: string;
  t: T;
  id?: string;
}) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`${t("decrease")}: ${label}`}
        className="flex size-[52px] shrink-0 items-center justify-center rounded-md border border-line bg-surface text-ink active:bg-canvas disabled:opacity-40"
      >
        <Minus className="size-6" />
      </button>
      <output id={id} aria-live="polite" className="num min-w-12 text-center text-2xl font-semibold text-ink">
        {value}
      </output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`${t("increase")}: ${label}`}
        className="flex size-[52px] shrink-0 items-center justify-center rounded-md border border-primary bg-primary text-primary-fg active:bg-primary-hover disabled:opacity-40"
      >
        <Plus className="size-6" />
      </button>
    </div>
  );
}

/** 4-digit PIN entry with a large keypad. Calls onComplete when 4 digits are entered. */
export function PinPad({
  title,
  hint,
  error,
  busy,
  t,
  onComplete,
}: {
  title: string;
  hint?: ReactNode;
  error?: ReactNode;
  busy?: boolean;
  t: T;
  onComplete: (pin: string) => void | Promise<void>;
}) {
  const [digits, setDigits] = useState("");
  const press = async (d: string) => {
    if (busy || digits.length >= 4) return;
    const next = digits + d;
    setDigits(next);
    if (next.length === 4) {
      await onComplete(next);
      setDigits("");
    }
  };
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
  return (
    <div className="mx-auto flex w-full max-w-[320px] flex-col items-center">
      <h1 className="text-center text-lg font-semibold text-ink">{title}</h1>
      {hint && <p className="mt-1 text-center text-sm text-ink-muted">{hint}</p>}
      <div className="my-5 flex gap-4" aria-label={`${digits.length}/4`} role="status">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("size-4 rounded-full border-2 border-primary", i < digits.length && "bg-primary")} />
        ))}
      </div>
      <div className="min-h-6 text-center text-sm font-medium text-status-danger-fg" role="alert">
        {busy ? <span className="text-ink-muted">{t("checking")}</span> : error}
      </div>
      <div className="mt-3 grid w-full grid-cols-3 gap-2">
        {keys.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} disabled={busy} className="num h-16 rounded-md border border-line bg-surface text-2xl font-semibold text-ink active:bg-canvas disabled:opacity-50">
            {k}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press("0")} disabled={busy} className="num h-16 rounded-md border border-line bg-surface text-2xl font-semibold text-ink active:bg-canvas disabled:opacity-50">
          0
        </button>
        <button
          type="button"
          onClick={() => setDigits((d) => d.slice(0, -1))}
          disabled={busy || digits.length === 0}
          aria-label={t("deleteDigit")}
          className="flex h-16 items-center justify-center rounded-md border border-line bg-surface text-ink active:bg-canvas disabled:opacity-40"
        >
          <Delete className="size-6" />
        </button>
      </div>
    </div>
  );
}

export function TextField({
  id,
  label,
  help,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { id: string; label: string; help?: string; error?: string | null }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={[help ? `${id}-help` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined}
        className="h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 aria-[invalid=true]:border-status-danger-fg"
        {...props}
      />
      {help && (
        <p id={`${id}-help`} className="mt-1 text-sm text-ink-muted">
          {help}
        </p>
      )}
      <FieldError id={`${id}-err`}>{error}</FieldError>
    </div>
  );
}

export function BigButton({ variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const v = {
    primary: "bg-primary text-primary-fg active:bg-primary-hover border-primary",
    secondary: "bg-surface text-ink border-line active:bg-canvas",
    danger: "bg-status-danger-fg text-white border-status-danger-fg",
  };
  return (
    <button
      type="button"
      className={cn("flex min-h-[52px] w-full items-center justify-center gap-2 rounded-md border px-4 text-base font-semibold disabled:opacity-50 [&_svg]:size-5", v[variant], className)}
      {...props}
    />
  );
}
