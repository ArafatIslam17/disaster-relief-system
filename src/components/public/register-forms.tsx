"use client";

import { useState } from "react";
import Link from "next/link";
import { dashTranslator, ROLE_LABELS, type Locale } from "@/lib/i18n/dictionary";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Field } from "./login-form";

const ORG_TYPES = ["National NGO", "International NGO", "Community-Based Organisation", "Volunteer Group", "Foundation", "Government Agency"];

function useForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return { busy, setBusy, error, setError, done, setDone };
}

function Done({ message, locale }: { message: string; locale: Locale }) {
  const t = dashTranslator(locale);
  return (
    <div className="space-y-4 rounded-md border border-line bg-surface p-5">
      <p role="status" className="rounded-md border border-status-ok-fg bg-status-ok-bg px-3 py-2 text-sm font-medium text-status-ok-fg">
        {message}
      </p>
      <Link href="/" className="text-sm font-semibold text-primary hover:underline">
        {t("backToPortal")}
      </Link>
    </div>
  );
}

/** UC-01: volunteer / staff self-registration under an approved organisation. */
export function RegisterAccountForm({ locale, organisations }: { locale: Locale; organisations: { organisationId: string; name: string }[] }) {
  const t = dashTranslator(locale);
  const f = useForm();
  const [v, setV] = useState({ organisationId: "", fullName: "", mobileNumber: "", password: "", confirm: "", role: "FIELD_VOLUNTEER" });
  if (f.done) return <Done message={f.done} locale={locale} />;

  return (
    <form
      noValidate
      className="space-y-4 rounded-md border border-line bg-surface p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (v.password !== v.confirm) return f.setError(t("passwordsDiffer"));
        f.setBusy(true);
        f.setError(null);
        try {
          await api("/api/auth/register", { body: { organisationId: v.organisationId, fullName: v.fullName, mobileNumber: v.mobileNumber, password: v.password, role: v.role } });
          f.setDone(t("registeredAccount"));
        } catch (err) {
          f.setError(err instanceof Error ? err.message : String(err));
        } finally {
          f.setBusy(false);
        }
      }}
    >
      <h1 className="text-lg font-semibold text-ink">{t("registerAccountTitle")}</h1>
      {organisations.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noApprovedOrgs")}</p>
      ) : (
        <>
          <div className="space-y-1">
            <Label htmlFor="org">{t("organisation")}</Label>
            <NativeSelect id="org" className="h-10 w-full" value={v.organisationId} onChange={(e) => setV({ ...v, organisationId: e.target.value })}>
              <option value="">{t("chooseOrganisation")}</option>
              {organisations.map((o) => (
                <option key={o.organisationId} value={o.organisationId}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label htmlFor="role">{t("role")}</Label>
            <NativeSelect id="role" className="h-10 w-full" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
              {["FIELD_VOLUNTEER", "GROUP_COORDINATOR"].map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r][locale]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Field id="name" label={t("fullName")} value={v.fullName} onChange={(x) => setV({ ...v, fullName: x })} autoComplete="name" />
          <Field id="mobile" label={t("mobileNumber")} value={v.mobileNumber} onChange={(x) => setV({ ...v, mobileNumber: x.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" numeric />
          <Field id="pw" label={t("password")} type="password" value={v.password} onChange={(x) => setV({ ...v, password: x })} help={t("passwordHelp")} autoComplete="new-password" />
          <Field id="pw2" label={t("confirmPassword")} type="password" value={v.confirm} onChange={(x) => setV({ ...v, confirm: x })} autoComplete="new-password" />
          {f.error && <p role="alert" className="text-sm font-medium text-status-danger-fg">{f.error}</p>}
          <Button type="submit" className="w-full" disabled={f.busy || !v.organisationId || v.fullName.trim().length < 2 || v.mobileNumber.length !== 11 || v.password.length < 8}>
            {t("submitRegistration")}
          </Button>
        </>
      )}
    </form>
  );
}

/** UC-03: organisation + first group coordinator. */
export function RegisterOrganisationForm({ locale }: { locale: Locale }) {
  const t = dashTranslator(locale);
  const f = useForm();
  const [v, setV] = useState({ name: "", orgType: ORG_TYPES[0], fullName: "", mobileNumber: "", password: "", confirm: "" });
  if (f.done) return <Done message={f.done} locale={locale} />;

  return (
    <form
      noValidate
      className="space-y-4 rounded-md border border-line bg-surface p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (v.password !== v.confirm) return f.setError(t("passwordsDiffer"));
        f.setBusy(true);
        f.setError(null);
        try {
          await api("/api/auth/register-org", { body: { organisation: { name: v.name, orgType: v.orgType }, coordinator: { fullName: v.fullName, mobileNumber: v.mobileNumber, password: v.password } } });
          f.setDone(t("registeredOrg", { name: v.name.trim() }));
        } catch (err) {
          f.setError(err instanceof Error ? err.message : String(err));
        } finally {
          f.setBusy(false);
        }
      }}
    >
      <h1 className="text-lg font-semibold text-ink">{t("registerOrgTitle")}</h1>
      <Field id="org-name" label={t("orgName")} value={v.name} onChange={(x) => setV({ ...v, name: x })} />
      <div className="space-y-1">
        <Label htmlFor="org-type">{t("orgType")}</Label>
        <NativeSelect id="org-type" className="h-10 w-full" value={v.orgType} onChange={(e) => setV({ ...v, orgType: e.target.value })}>
          {ORG_TYPES.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      </div>
      <h2 className="border-t border-line pt-4 text-sm font-semibold text-ink">{t("coordinatorDetails")}</h2>
      <Field id="name" label={t("fullName")} value={v.fullName} onChange={(x) => setV({ ...v, fullName: x })} autoComplete="name" />
      <Field id="mobile" label={t("mobileNumber")} value={v.mobileNumber} onChange={(x) => setV({ ...v, mobileNumber: x.replace(/\D/g, "").slice(0, 11) })} inputMode="numeric" numeric />
      <Field id="pw" label={t("password")} type="password" value={v.password} onChange={(x) => setV({ ...v, password: x })} help={t("passwordHelp")} autoComplete="new-password" />
      <Field id="pw2" label={t("confirmPassword")} type="password" value={v.confirm} onChange={(x) => setV({ ...v, confirm: x })} autoComplete="new-password" />
      {f.error && <p role="alert" className="text-sm font-medium text-status-danger-fg">{f.error}</p>}
      <Button type="submit" className="w-full" disabled={f.busy || v.name.trim().length < 3 || v.fullName.trim().length < 2 || v.mobileNumber.length !== 11 || v.password.length < 8}>
        {t("submitRegistration")}
      </Button>
    </form>
  );
}
