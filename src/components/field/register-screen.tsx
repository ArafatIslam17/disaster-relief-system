"use client";

import { useMemo, useState } from "react";
import { Check, MapPin, X } from "lucide-react";
import { CONSENT_STATEMENT } from "@/lib/i18n/dictionary";
import { householdSimilarity, type HouseholdFeatures } from "@/lib/detection/similarity";
import { displayCode, registerHousehold, type DecryptedHousehold } from "@/lib/field/repo";
import { Badge } from "@/components/ui/badge";
import { useField } from "./field-provider";
import { areaLabel, Banner, BigButton, FieldError, ScreenTitle, Stepper, TextField } from "./field-ui";

const HEAD_NAME_RE = /^[A-Za-z][A-Za-z .'-]*$/;
const MOBILE_RE = /^01[3-9][0-9]{8}$/;
const POSSIBLE = 0.65;
const LIKELY = 0.85;

type Step = "consent" | "details" | "check" | "slip";
type Match = { household: DecryptedHousehold; score: number };

/** UC-11 / UC-12 / Sequence Diagram 01. */
export function RegisterScreen() {
  const { t, locale, areas, areasById, households, householdsById, session, navigate, setIntent, sync } = useField();
  const downloaded = useMemo(() => areas.filter((a) => a.downloaded === 1), [areas]);

  const [step, setStep] = useState<Step>("consent");
  const [consentAt, setConsentAt] = useState("");
  const [headName, setHeadName] = useState("");
  const [mobile, setMobile] = useState("");
  const [areaId, setAreaId] = useState("");
  const [members, setMembers] = useState(1);
  const [gps, setGps] = useState<string | null>(null);
  const [gpsState, setGpsState] = useState<"idle" | "locating" | "failed">("idle");
  const [touched, setTouched] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const selectedArea = areaId || (downloaded.length === 1 ? downloaded[0].areaId : "");
  const name = headName.trim().replace(/\s+/g, " ");
  const nameError = name.length < 2 || !HEAD_NAME_RE.test(name) ? t("headNameError") : null;
  const mobileError = mobile && !MOBILE_RE.test(mobile) ? t("mobileError") : null;
  const formValid = !nameError && !mobileError && !!selectedArea;

  function reset() {
    setStep("consent");
    setHeadName("");
    setMobile("");
    setMembers(1);
    setGps(null);
    setGpsState("idle");
    setTouched(false);
    setMatches([]);
    setSavedId(null);
    setSaveError(null);
  }

  function locate() {
    if (!("geolocation" in navigator)) return setGpsState("failed");
    setGpsState("locating");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGps(`${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`);
        setGpsState("idle");
      },
      () => setGpsState("failed"),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }

  /** Local similarity check against every household on this phone in the same union (<1 s). */
  function runCheck() {
    setTouched(true);
    if (!formValid) return;
    const area = areasById.get(selectedArea)!;
    const candidate: HouseholdFeatures = { headName: name, mobileNumber: mobile || null, memberCount: members, areaId: area.areaId, ward: area.ward };
    const found: Match[] = [];
    for (const h of households) {
      const ha = areasById.get(h.areaId);
      if (!ha || ha.unionName !== area.unionName) continue;
      const { score } = householdSimilarity(candidate, { headName: h.headName, mobileNumber: h.mobileMasked ? null : h.mobileNumber, memberCount: h.memberCount, areaId: h.areaId, ward: ha.ward });
      if (score >= POSSIBLE) found.push({ household: h, score });
    }
    found.sort((a, b) => b.score - a.score);
    setMatches(found.slice(0, 3));
    setStep("check");
  }

  async function save() {
    if (!session) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { householdId } = await registerHousehold(session, { areaId: selectedArea, headName: name, mobileNumber: mobile || null, memberCount: members, gpsLocation: gps, consentAt });
      setSavedId(householdId);
      setStep("slip");
      sync.requestSync();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (step === "consent") {
    return (
      <section>
        <ScreenTitle sub={t("stepConsent")}>{t("registerTitle")}</ScreenTitle>
        <p className="mb-2 text-sm font-semibold text-ink">{t("consentRead")}</p>
        <div className="space-y-3 rounded-md border border-line bg-surface p-4">
          <p lang="bn" className="font-bangla text-[17px] leading-relaxed text-ink">
            {CONSENT_STATEMENT.bn}
          </p>
          <hr className="border-line" />
          <p lang="en" className="text-[15px] leading-relaxed text-ink">
            {CONSENT_STATEMENT.en}
          </p>
        </div>
        <div className="mt-4 space-y-3">
          <BigButton
            onClick={() => {
              setConsentAt(new Date().toISOString());
              setStep("details");
            }}
            className="min-h-14"
          >
            <Check aria-hidden /> <span className="font-bangla">{CONSENT_STATEMENT.given}</span>
          </BigButton>
          <BigButton
            variant="secondary"
            className="min-h-14"
            onClick={() => {
              setIntent({ anonymous: true });
              navigate("/field/distribute");
            }}
          >
            <X aria-hidden /> <span className="font-bangla">{CONSENT_STATEMENT.declined}</span>
          </BigButton>
        </div>
      </section>
    );
  }

  if (step === "details") {
    return (
      <section>
        <ScreenTitle sub={t("stepDetails")}>{t("registerTitle")}</ScreenTitle>
        {downloaded.length === 0 ? (
          <div className="space-y-3">
            <Banner tone="pending">{t("noWards")}</Banner>
            <BigButton onClick={() => navigate("/field/sync")}>{t("navSync")}</BigButton>
          </div>
        ) : (
          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              runCheck();
            }}
          >
            <TextField id="head-name" label={t("headName")} help={t("headNameHelp")} error={touched ? nameError : null} value={headName} onChange={(e) => setHeadName(e.target.value)} autoComplete="off" autoCapitalize="words" lang="en" />
            <TextField id="hh-mobile" label={t("mobileOptional")} help={t("mobileHelp")} error={touched ? mobileError : null} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" className="num" autoComplete="off" />
            <div>
              <label htmlFor="hh-area" className="mb-1 block text-sm font-semibold text-ink">
                {t("ward")}
              </label>
              <select id="hh-area" value={selectedArea} onChange={(e) => setAreaId(e.target.value)} aria-invalid={touched && !selectedArea} className="h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink aria-[invalid=true]:border-status-danger-fg">
                <option value="">{t("chooseWard")}</option>
                {downloaded.map((a) => (
                  <option key={a.areaId} value={a.areaId}>
                    {areaLabel(a, locale, t)}
                  </option>
                ))}
              </select>
              <FieldError>{touched && !selectedArea ? t("chooseWard") : null}</FieldError>
            </div>
            <div>
              <span className="mb-1 block text-sm font-semibold text-ink">{t("members")}</span>
              <Stepper value={members} onChange={setMembers} min={1} max={50} label={t("members")} t={t} />
            </div>
            <div className="space-y-2">
              {gps ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2">
                  <span className="num flex items-center gap-2 text-sm text-ink">
                    <MapPin className="size-4 text-primary" aria-hidden />
                    {gps}
                  </span>
                  <button type="button" className="h-10 px-2 text-sm font-semibold text-status-danger-fg" onClick={() => setGps(null)}>
                    {t("gpsRemove")}
                  </button>
                </div>
              ) : (
                <BigButton variant="secondary" onClick={locate} disabled={gpsState === "locating"}>
                  <MapPin aria-hidden /> {gpsState === "locating" ? t("gpsLocating") : t("gps")}
                </BigButton>
              )}
              {gpsState === "failed" && <p className="text-sm text-ink-muted">{t("gpsFailed")}</p>}
            </div>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <BigButton variant="secondary" onClick={() => setStep("consent")}>
                {t("back")}
              </BigButton>
              <BigButton type="submit">{t("next")}</BigButton>
            </div>
          </form>
        )}
      </section>
    );
  }

  if (step === "check") {
    return (
      <section>
        <ScreenTitle sub={t("stepCheck")}>{t("registerTitle")}</ScreenTitle>
        {matches.length > 0 ? (
          <div className="space-y-3">
            <Banner tone="pending">{t("matchesFound", { n: matches.length })}</Banner>
            {matches.map(({ household: h, score }) => (
              <article key={h.householdId} className="rounded-md border border-line bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="num text-lg font-bold text-ink">{displayCode(h)}</p>
                    <p className="truncate text-base font-semibold text-ink">{h.headName}</p>
                  </div>
                  <Badge tone={score >= LIKELY ? "danger" : "pending"} className="num">
                    {t("similarity", { score: score.toFixed(2) })}
                  </Badge>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-ink-muted">{t("mobileNumber")}</dt>
                  <dd className="num text-ink">{h.mobileNumber ?? "—"} {h.mobileMasked && <span className="text-ink-muted">{t("otherOrgMasked")}</span>}</dd>
                  <dt className="text-ink-muted">{t("members")}</dt>
                  <dd className="num text-ink">{h.memberCount}</dd>
                  <dt className="text-ink-muted">{t("ward")}</dt>
                  <dd className="text-ink">{areaLabel(areasById.get(h.areaId), locale, t)}</dd>
                </dl>
                <BigButton
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    setIntent({ distributeHouseholdId: h.householdId });
                    navigate("/field/distribute");
                    reset();
                  }}
                >
                  {t("selectExisting")}
                </BigButton>
              </article>
            ))}
          </div>
        ) : (
          <Banner tone="ok">{t("noMatches")}</Banner>
        )}
        <div className="mt-4 rounded-md border border-line bg-surface p-3 text-sm">
          <p className="text-base font-semibold text-ink">{name}</p>
          <p className="num text-ink-muted">
            {mobile || "—"} · {t("membersShort", { n: members })} · {areaLabel(areasById.get(selectedArea), locale, t)}
          </p>
        </div>
        <FieldError>{saveError}</FieldError>
        <div className="mt-4 grid grid-cols-[1fr_2fr] gap-2">
          <BigButton variant="secondary" onClick={() => setStep("details")}>
            {t("back")}
          </BigButton>
          <BigButton onClick={save} disabled={saving}>
            {saving ? t("saving") : t("confirmNew")}
          </BigButton>
        </div>
      </section>
    );
  }

  const saved = savedId ? householdsById.get(savedId) : undefined;
  const finalCode = saved?.shortCode ?? null;
  return (
    <section>
      <ScreenTitle>{t("slipTitle")}</ScreenTitle>
      <div className="rounded-md border-[3px] border-ink bg-surface p-5 text-center" aria-live="polite">
        <p className="num text-[52px] font-extrabold leading-none tracking-wider text-ink" data-testid="slip-code">
          {saved ? displayCode(saved) : "…"}
        </p>
        <p className="mt-3 text-lg font-semibold text-ink">{saved?.headName}</p>
        <p className="num text-sm text-ink-muted">
          {saved && t("membersShort", { n: saved.memberCount })} · {areaLabel(saved ? areasById.get(saved.areaId) : undefined, locale, t)}
        </p>
      </div>
      <div className="mt-3">
        {finalCode ? <Banner tone="ok">{t("slipFinal")}</Banner> : <Banner tone="pending">{t("slipTemporary")}</Banner>}
      </div>
      <div className="mt-4 space-y-3">
        <BigButton
          onClick={() => {
            if (savedId) setIntent({ distributeHouseholdId: savedId });
            navigate("/field/distribute");
            reset();
          }}
        >
          {t("distributeNow")}
        </BigButton>
        <BigButton variant="secondary" onClick={reset}>
          {t("registerAnother")}
        </BigButton>
      </div>
    </section>
  );
}
