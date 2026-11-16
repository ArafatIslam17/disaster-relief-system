"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { cn } from "@/lib/utils";
import { fieldDb, type LocalDistribution } from "@/lib/offline-db";
import { canVoid, displayCode, editHousehold, voidDistribution, type DecryptedHousehold } from "@/lib/field/repo";
import { StatusBadge } from "@/components/status-badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useField } from "./field-provider";
import { matchHousehold } from "./distribute-screen";
import { areaLabel, Banner, BigButton, FieldError, fmtDateTime, ScreenTitle, Stepper, TextField } from "./field-ui";

const HEAD_NAME_RE = /^[A-Za-z][A-Za-z .'-]*$/;
const MOBILE_RE = /^01[3-9][0-9]{8}$/;

/** UC-14 / UC-15: local records, versioned edits and 24-hour voids. */
export function RecordsScreen() {
  const { t, households, distributions, householdsById } = useField();
  const [tab, setTab] = useState<"households" | "distributions">("households");
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const pendingEntities =
    useLiveQuery(async () => new Set((await fieldDb().outboxEvents.where("state").anyOf("Pending", "Uploading", "Failed").toArray()).map((e) => e.entityId)), []) ?? new Set<string>();

  const q = filter.trim();
  const hh = useMemo(() => (q.length >= 2 ? households.filter((h) => matchHousehold(h, q)) : households), [households, q]);
  const ds = useMemo(
    () =>
      q.length >= 2
        ? distributions.filter((d) => {
            const h = d.householdId ? householdsById.get(d.householdId) : undefined;
            return h ? matchHousehold(h, q) : false;
          })
        : distributions,
    [distributions, householdsById, q],
  );

  return (
    <section className="space-y-3">
      <ScreenTitle>{t("recordsTitle")}</ScreenTitle>
      <div role="tablist" className="grid grid-cols-2 rounded-md border border-line bg-surface p-1">
        {(["households", "distributions"] as const).map((k) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-11 rounded-sm text-sm font-semibold", tab === k ? "bg-primary text-primary-fg" : "text-ink-muted")}>
            {k === "households" ? t("tabHouseholds") : t("tabDistributions")} <span className="num">({k === "households" ? hh.length : ds.length})</span>
          </button>
        ))}
      </div>
      <input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={t("filterPlaceholder")}
        aria-label={t("filterPlaceholder")}
        className="h-12 w-full rounded-md border border-line bg-surface px-3 text-base text-ink placeholder:text-ink-faint focus-visible:border-primary focus-visible:outline-none"
      />
      {tab === "households" ? (
        hh.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("noHouseholds")}</p>
        ) : (
          <ul className="space-y-2">
            {hh.slice(0, 100).map((h) => (
              <HouseholdRow key={h.householdId} h={h} open={openId === h.householdId} onToggle={() => setOpenId(openId === h.householdId ? null : h.householdId)} pending={pendingEntities.has(h.householdId)} />
            ))}
          </ul>
        )
      ) : ds.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("noDistributions")}</p>
      ) : (
        <ul className="space-y-2">
          {ds.slice(0, 100).map((d) => (
            <DistributionRow key={d.distributionId} d={d} pending={pendingEntities.has(d.distributionId)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HouseholdRow({ h, open, onToggle, pending }: { h: DecryptedHousehold; open: boolean; onToggle: () => void; pending: boolean }) {
  const { t, locale, areasById, sync } = useField();
  const [headName, setHeadName] = useState(h.headName);
  const [mobile, setMobile] = useState(h.mobileMasked ? "" : (h.mobileNumber ?? ""));
  const [members, setMembers] = useState(h.memberCount);
  const [message, setMessage] = useState<{ tone: "ok" | "neutral"; text: string } | null>(null);
  const [touched, setTouched] = useState(false);

  const name = headName.trim().replace(/\s+/g, " ");
  const nameError = name.length < 2 || !HEAD_NAME_RE.test(name) ? t("headNameError") : null;
  const mobileError = mobile && !MOBILE_RE.test(mobile) ? t("mobileError") : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError || mobileError) return;
    const changed = await editHousehold(h, { headName: name, ...(h.mobileMasked ? {} : { mobileNumber: mobile || null }), memberCount: members });
    setMessage(changed ? { tone: "ok", text: t("savedLocal") } : { tone: "neutral", text: t("noChanges") });
    if (changed) sync.requestSync();
  }

  return (
    <li className="rounded-md border border-line bg-surface">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[60px] w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="min-w-0">
          <span className="num block text-base font-bold text-ink">{displayCode(h)}</span>
          <span className="block truncate text-sm text-ink">{h.headName}</span>
          <span className="num block text-xs text-ink-muted">
            {t("membersShort", { n: h.memberCount })} · {areaLabel(areasById.get(h.areaId), locale, t)}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {pending && <StatusBadge status="Pending" locale={locale} />}
          <span className="text-sm font-semibold text-primary">{t("edit")}</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-line p-3">
          {!h.ownOrganisation ? (
            <Banner tone="neutral">{t("editNotOwn")}</Banner>
          ) : (
            <form onSubmit={save} className="space-y-4" noValidate>
              <p className="num text-xs text-ink-muted">{t("versionN", { n: h.version })}</p>
              <TextField id={`edit-name-${h.householdId}`} label={t("headName")} help={t("headNameHelp")} error={touched ? nameError : null} value={headName} onChange={(e) => setHeadName(e.target.value)} lang="en" />
              {!h.mobileMasked && (
                <TextField id={`edit-mobile-${h.householdId}`} label={t("mobileOptional")} error={touched ? mobileError : null} value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" className="num" />
              )}
              <div>
                <span className="mb-1 block text-sm font-semibold text-ink">{t("members")}</span>
                <Stepper value={members} onChange={setMembers} min={1} max={50} label={t("members")} t={t} />
              </div>
              <p className="text-sm text-ink-muted">{t("editHint")}</p>
              {message && <Banner tone={message.tone}>{message.text}</Banner>}
              <BigButton type="submit">{t("saveChanges")}</BigButton>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

function DistributionRow({ d, pending }: { d: LocalDistribution; pending: boolean }) {
  const { t, locale, householdsById, areasById, items, session, sync } = useField();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const h = d.householdId ? householdsById.get(d.householdId) : undefined;
  const mine = d.recordedBy === session?.userId;
  const voidable = !!session && canVoid(d, session.userId);
  const itemName = (id: string) => items.find((i) => i.itemId === id)?.itemName ?? id;

  async function confirmVoid() {
    if (reason.trim().length < 5) return setError(t("cancelReasonError"));
    try {
      await voidDistribution(d, session!.userId, reason.trim());
      setOpen(false);
      sync.requestSync();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <li className="rounded-md border border-line bg-surface p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="num text-base font-bold text-ink">{d.isAnonymous ? t("anonymous") : h ? displayCode(h) : "—"}</p>
          {h && <p className="truncate text-sm text-ink">{h.headName}</p>}
          <p className="num text-xs text-ink-muted">
            {fmtDateTime(d.distributedAt, locale)} · {areaLabel(areasById.get(d.areaId), locale, t)}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusBadge status={d.status} locale={locale} />
          {pending && <StatusBadge status="Pending" locale={locale} />}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink">{d.items.map((i) => `${itemName(i.itemId)} × ${i.quantity}`).join(", ")}</p>
      {mine && <p className="text-xs text-ink-muted">{t("recordedByYou")}</p>}
      {d.status === "Voided" && d.cancelReason && <p className="mt-1 text-sm text-status-danger-fg">{d.cancelReason}</p>}
      {d.status === "Active" && voidable && (
        <>
          <BigButton variant="secondary" className="mt-2 border-status-danger-fg text-status-danger-fg" onClick={() => setOpen(true)}>
            {t("voidAction")}
          </BigButton>
          <p className="mt-1 text-xs text-ink-muted">{t("voidWindowClosed")}</p>
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("voidTitle")}</DialogTitle>
            <DialogDescription>{t("voidBody")}</DialogDescription>
          </DialogHeader>
          <label htmlFor={`reason-${d.distributionId}`} className="mb-1 block text-sm font-semibold text-ink">
            {t("cancelReason")}
          </label>
          <textarea
            id={`reason-${d.distributionId}`}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            rows={3}
            className="w-full rounded-md border border-line bg-surface p-3 text-base text-ink focus-visible:border-primary focus-visible:outline-none"
          />
          <FieldError>{error}</FieldError>
          <DialogFooter>
            <Button variant="secondary" size="lg" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" size="lg" onClick={confirmVoid}>
              {t("voidAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
