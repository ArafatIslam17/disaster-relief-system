"use client";

import { useRef, useState } from "react";
import { getDeviceId, unsyncedCount, wipeLocalData } from "@/lib/offline-db";
import { ApiFailure, fieldFetch, networkAvailable, OfflineError } from "@/lib/field/api";
import { pullReferenceData } from "@/lib/field/sync";
import { createVaultKey, getSession, lockVault, rewrapPassword, setPinAndSave, unlockWithPassword, type SessionIdentity } from "@/lib/field/vault";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useField } from "./field-provider";
import { BigButton, Banner, FieldError, PinPad, TextField } from "./field-ui";

type Mode = "new" | "reauth" | "refresh";
type Step = "credentials" | "otherUser" | "changePassword" | "chooseOperation" | "recover" | "pinSet" | "pinConfirm";

type LoginResponse = {
  user: { userId: string; fullName: string; role: string; organisationId: string | null; organisationName: string | null };
  device: { deviceId: string; deviceLabel: string } | null;
  mustChangePassword: boolean;
};
type Operation = { operationId: string; name: string; status: string; myMembership: { status: string } | null };

const FIELD_ROLES = ["FIELD_VOLUNTEER", "GROUP_COORDINATOR"];

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = ua.match(/Android [\d.]+/)?.[0] ?? ua.match(/iPhone OS [\d_]+/)?.[0]?.replace(/_/g, ".") ?? navigator.platform ?? "Unknown";
  return `Field app · ${os}`.slice(0, 100);
}

/**
 * Online sign-in (UC-02). Used for first sign-in ("new"), recovery after PIN lockout/expiry
 * ("reauth"), and renewing an expired server session while unlocked ("refresh").
 */
export function LoginScreen({ mode: initialMode }: { mode: Mode }) {
  const { t, session, setPhase, navigate, setReauthOpen, sync } = useField();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [step, setStep] = useState<Step>("credentials");
  const [mobile, setMobile] = useState(initialMode === "new" ? "" : (session?.mobileNumber ?? ""));
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [previousPassword, setPreviousPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<Operation[]>([]);
  const [otherUser, setOtherUser] = useState<{ name: string; n: number } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const user = useRef<LoginResponse["user"] | null>(null);
  const deviceId = useRef<string>("");
  const activePassword = useRef<string>("");
  const operation = useRef<Operation | null>(null);
  const firstPin = useRef<string>("");

  const describe = (err: unknown) => (err instanceof OfflineError ? t("needNetwork") : err instanceof ApiFailure ? err.message : err instanceof Error ? err.message : String(err));

  async function submitCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!networkAvailable()) return setError(t("needNetwork"));
    const existing = await getSession();
    if (mode === "new" && existing && existing.mobileNumber !== mobile.trim()) {
      const n = await unsyncedCount();
      if (n > 0) {
        setOtherUser({ name: existing.fullName, n });
        setStep("otherUser");
        return;
      }
      await wipeLocalData();
      lockVault();
    }
    setBusy(true);
    try {
      const current = await getSession();
      deviceId.current = current?.deviceId ?? (await getDeviceId());
      const res = await fieldFetch<LoginResponse>("/api/auth/login", {
        body: { mobileNumber: mobile.trim(), password, deviceId: deviceId.current, deviceLabel: deviceLabel() },
      });
      if (!FIELD_ROLES.includes(res.user.role)) {
        await fieldFetch("/api/auth/logout", { body: {} }).catch(() => undefined);
        return setError(t("wrongRole"));
      }
      user.current = res.user;
      if (res.mustChangePassword) {
        activePassword.current = password;
        setStep("changePassword");
        return;
      }
      await afterAuth(password);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function submitNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fieldFetch("/api/auth/change-password", { body: { currentPassword: activePassword.current, newPassword } });
      await afterAuth(newPassword);
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function afterAuth(pw: string) {
    activePassword.current = pw;
    const res = await fieldFetch<{ operations: Operation[] }>("/api/operations");
    const candidates = res.operations.filter((o) => o.status === "Active" && o.myMembership?.status === "Approved");
    if (candidates.length === 0) {
      await fieldFetch("/api/auth/logout", { body: {} }).catch(() => undefined);
      setError(t("noOperation"));
      setStep("credentials");
      return;
    }
    const existing = await getSession();
    const keep = existing ? candidates.find((o) => o.operationId === existing.operationId) : undefined;
    if (keep || candidates.length === 1) return chooseOperation(keep ?? candidates[0]);
    setOps(candidates);
    setStep("chooseOperation");
  }

  async function chooseOperation(op: Operation) {
    operation.current = op;
    if (mode === "refresh") {
      await rewrapPassword(activePassword.current, { operationId: op.operationId, operationName: op.name });
      setReauthOpen(false);
      void sync.syncNow(true);
      return;
    }
    const existing = await getSession();
    if (existing && existing.userId === user.current?.userId) {
      if (await unlockWithPassword(activePassword.current)) setStep("pinSet");
      else setStep("recover");
      return;
    }
    await createVaultKey();
    setStep("pinSet");
  }

  async function submitRecover(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const ok = await unlockWithPassword(previousPassword);
    setBusy(false);
    if (ok) setStep("pinSet");
    else setError(t("recoverFailed"));
  }

  async function openDiscard() {
    setDiscardCount(await unsyncedCount());
    setDiscardOpen(true);
  }

  async function confirmDiscard() {
    await wipeLocalData();
    lockVault();
    setDiscardOpen(false);
    setOtherUser(null);
    setMode("new");
    setMobile("");
    setPassword("");
    setError(null);
    setStep("credentials");
  }

  async function finishPin(pin: string) {
    if (pin !== firstPin.current) {
      firstPin.current = "";
      setPinError(t("pinMismatch"));
      setStep("pinSet");
      return;
    }
    setBusy(true);
    const u = user.current!;
    const op = operation.current!;
    const identity: SessionIdentity = {
      userId: u.userId,
      fullName: u.fullName,
      mobileNumber: mobile.trim(),
      role: u.role,
      organisationId: u.organisationId,
      organisationName: u.organisationName,
      deviceId: deviceId.current,
      operationId: op.operationId,
      operationName: op.name,
    };
    await setPinAndSave(identity, pin, activePassword.current);
    await pullReferenceData().catch(() => undefined);
    setBusy(false);
    setPhase("ready");
    if (mode === "new") navigate("/field/sync");
  }

  const title = mode === "reauth" ? t("reauthTitle") : mode === "refresh" ? t("refreshTitle") : t("loginTitle");

  if (step === "pinSet")
    return (
      <PinPad
        key="set"
        t={t}
        title={t("pinSetTitle")}
        hint={t("pinSetHint")}
        error={pinError}
        onComplete={(pin) => {
          firstPin.current = pin;
          setPinError(null);
          setStep("pinConfirm");
        }}
      />
    );
  if (step === "pinConfirm") return <PinPad key="confirm" t={t} title={t("pinConfirmTitle")} busy={busy} onComplete={finishPin} />;

  return (
    <div className="mx-auto w-full max-w-[420px] space-y-4">
      <h1 className="text-lg font-semibold text-ink">{step === "changePassword" ? t("changePasswordTitle") : step === "recover" ? t("recoverTitle") : step === "chooseOperation" ? t("chooseOperation") : title}</h1>

      {mode === "reauth" && step === "credentials" && session && (
        <Banner tone="danger">{session.lockedOut ? t("pinLockedOut") : t("pinExpired")}</Banner>
      )}

      {step === "credentials" && (
        <form onSubmit={submitCredentials} className="space-y-4" noValidate>
          <p className="text-sm text-ink-muted">{t("loginHint")}</p>
          <TextField id="login-mobile" label={t("mobileNumber")} inputMode="numeric" autoComplete="username" className="num" value={mobile} readOnly={mode !== "new"} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))} required />
          <TextField id="login-password" label={t("password")} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <FieldError>{error}</FieldError>
          <BigButton type="submit" disabled={busy || mobile.length !== 11 || !password}>
            {busy ? t("signingIn") : t("signIn")}
          </BigButton>
          {mode === "reauth" && (
            <BigButton variant="secondary" onClick={openDiscard}>
              {t("discardLocal")}
            </BigButton>
          )}
          {mode === "refresh" && (
            <BigButton variant="secondary" onClick={() => setReauthOpen(false)}>
              {t("cancel")}
            </BigButton>
          )}
        </form>
      )}

      {step === "otherUser" && otherUser && (
        <div className="space-y-4">
          <Banner tone="danger">{t("otherUserData", { n: otherUser.n, name: otherUser.name })}</Banner>
          <BigButton variant="secondary" onClick={() => setStep("credentials")}>
            {t("back")}
          </BigButton>
          <BigButton variant="danger" onClick={openDiscard}>
            {t("discardLocal")}
          </BigButton>
        </div>
      )}

      {step === "changePassword" && (
        <form onSubmit={submitNewPassword} className="space-y-4" noValidate>
          <p className="text-sm text-ink-muted">{t("changePasswordHint")}</p>
          <TextField id="new-password" label={t("newPassword")} type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <FieldError>{error}</FieldError>
          <BigButton type="submit" disabled={busy || newPassword.length < 8}>
            {t("savePassword")}
          </BigButton>
        </form>
      )}

      {step === "chooseOperation" && (
        <div className="space-y-2">
          {ops.map((o) => (
            <BigButton key={o.operationId} variant="secondary" className="justify-start text-left" onClick={() => chooseOperation(o).catch((err) => setError(describe(err)))}>
              {o.name}
            </BigButton>
          ))}
          <FieldError>{error}</FieldError>
        </div>
      )}

      {step === "recover" && (
        <form onSubmit={submitRecover} className="space-y-4" noValidate>
          <p className="text-sm text-ink-muted">{t("recoverHint")}</p>
          <TextField id="previous-password" label={t("previousPassword")} type="password" value={previousPassword} onChange={(e) => setPreviousPassword(e.target.value)} />
          <FieldError>{error}</FieldError>
          <BigButton type="submit" disabled={busy || !previousPassword}>
            {t("recover")}
          </BigButton>
          <BigButton variant="secondary" onClick={openDiscard}>
            {t("discardLocal")}
          </BigButton>
        </form>
      )}

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("discardConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("discardConfirmBody", { n: discardCount })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" size="lg" onClick={() => setDiscardOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" size="lg" onClick={confirmDiscard}>
              {t("deleteData")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
