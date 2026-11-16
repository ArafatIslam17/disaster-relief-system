"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dashTranslator, ROLE_LABELS, type Locale } from "@/lib/i18n/dictionary";
import { api, ClientApiError } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoginResponse = { user: { role: string }; mustChangePassword: boolean };

/** Seeded demo accounts. Shown only when NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=true (never in production). */
const DEMO_ACCOUNTS = [
  { role: "FIELD_VOLUNTEER", name: "Sumaiya Rahman", mobile: "01711000011", password: "Volunteer@2026" },
  { role: "GROUP_COORDINATOR", name: "Rafiqul Islam", mobile: "01711000010", password: "Coordinator@2026" },
  { role: "OPERATION_ADMINISTRATOR", name: "Nusrat Jahan", mobile: "01700000002", password: "OpsAdmin@2026" },
  { role: "SYSTEM_ADMINISTRATOR", name: "Tanvir Ahmed", mobile: "01700000001", password: "SysAdmin@2026" },
  { role: "OBSERVER", name: "Farhana Akter", mobile: "01700000005", password: "Observer@2026" },
];

const home = (role: string) => (role === "FIELD_VOLUNTEER" ? "/field" : "/dashboard/coverage");

function remaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function LoginForm({ locale, mustChange, role }: { locale: Locale; mustChange: boolean; role: string | null }) {
  const t = dashTranslator(locale);
  const router = useRouter();
  const [step, setStep] = useState<"login" | "change">(mustChange ? "change" : "login");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [userRole, setUserRole] = useState(role);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const showDemo = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true";

  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);
  const locked = lockedUntil !== null && lockedUntil > now;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<LoginResponse>("/api/auth/login", { body: { mobileNumber: mobile, password } });
      setLockedUntil(null);
      setUserRole(r.user.role);
      if (r.mustChangePassword) {
        setCurrent(password);
        setStep("change");
        return;
      }
      router.push(home(r.user.role));
      router.refresh();
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "ACCOUNT_LOCKED") {
        const until = (err.details as { lockedUntil?: string | null } | undefined)?.lockedUntil;
        setLockedUntil(until ? new Date(until).getTime() : null);
        setNow(Date.now());
        setError(until ? null : t("lockedNoTime"));
      } else setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (next !== confirm) return setError(t("passwordsDiffer"));
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/change-password", { body: { currentPassword: current, newPassword: next } });
      router.push(home(userRole ?? ""));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === "change") {
    return (
      <form onSubmit={change} className="space-y-4 rounded-md border border-line bg-surface p-5" noValidate>
        <h1 className="text-lg font-semibold text-ink">{t("changePasswordTitle")}</h1>
        <p className="text-sm text-ink-muted">{t("changePasswordHint")}</p>
        <Field id="cur" label={t("currentPassword")} type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field id="new" label={t("newPassword")} type="password" value={next} onChange={setNext} autoComplete="new-password" help={t("passwordHelp")} />
        <Field id="conf" label={t("confirmPassword")} type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && <p role="alert" className="text-sm font-medium text-status-danger-fg">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !current || next.length < 8}>
          {t("savePassword")}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-4 rounded-md border border-line bg-surface p-5" noValidate>
        <h1 className="text-lg font-semibold text-ink">{t("loginTitle")}</h1>
        <Field id="mobile" label={t("mobileNumber")} value={mobile} onChange={(v) => setMobile(v.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" autoComplete="username" numeric />
        <Field id="password" label={t("password")} type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        {locked && (
          <p role="alert" className="rounded-md border border-status-danger-fg bg-status-danger-bg px-3 py-2 text-sm font-medium text-status-danger-fg">
            {t("lockedCountdown", { time: remaining(lockedUntil! - now) })}
          </p>
        )}
        {error && <p role="alert" className="text-sm font-medium text-status-danger-fg">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || locked || mobile.length !== 11 || !password}>
          {busy ? t("signingIn") : t("signIn")}
        </Button>
        <p className="text-sm text-ink-muted">
          {t("noAccount")}{" "}
          <Link href="/register" className="font-semibold text-primary hover:underline">
            {t("registerLink")}
          </Link>
        </p>
      </form>

      {showDemo && (
        <details className="rounded-md border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">{t("demoAccounts")}</summary>
          <div className="border-t border-line px-4 py-3">
            <p className="mb-2 text-xs text-ink-muted">{t("demoHint")}</p>
            <ul className="divide-y divide-line">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.mobile}>
                  <button
                    type="button"
                    onClick={() => {
                      setMobile(a.mobile);
                      setPassword(a.password);
                      setError(null);
                    }}
                    className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-canvas"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-ink">{ROLE_LABELS[a.role][locale]}</span>
                      <span className="block text-xs text-ink-muted">{a.name}</span>
                    </span>
                    <span className="num text-right text-xs text-ink-muted">
                      {a.mobile}
                      <span className="block font-mono">{a.password}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}

export function Field({
  id,
  label,
  value,
  onChange,
  type = "text",
  help,
  numeric,
  ...rest
}: { id: string; label: string; value: string; onChange: (v: string) => void; type?: string; help?: string; numeric?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value">) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className={numeric ? "num" : undefined} {...rest} />
      {help && <p className="text-xs text-ink-muted">{help}</p>}
    </div>
  );
}
