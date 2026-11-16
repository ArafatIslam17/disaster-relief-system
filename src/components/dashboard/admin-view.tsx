"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, STATUS_LABELS } from "@/lib/i18n/dictionary";
import { api, qs } from "@/lib/client-api";
import { fmtDateTime } from "@/lib/format";
import { useApi } from "@/hooks/useApi";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, Textarea } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog, ErrorText, LoadState, Notice, PageHeader, Panel } from "./common";
import { useDash } from "./dash-provider";

type Tab = "organisations" | "users" | "memberships" | "purge";
const ALL_ROLES: UserRole[] = ["FIELD_VOLUNTEER", "GROUP_COORDINATOR", "OPERATION_ADMINISTRATOR", "SYSTEM_ADMINISTRATOR", "OBSERVER"];
const COORDINATOR_ROLES: UserRole[] = ["FIELD_VOLUNTEER", "GROUP_COORDINATOR"];

/** UC-03..05, UC-08, UC-09, NFR03, NFR07. */
export function AdminView() {
  const { t, can } = useDash();
  const params = useSearchParams();
  const router = useRouter();
  const tabs: { id: Tab; label: string }[] = [];
  if (can("organisation.review")) tabs.push({ id: "organisations", label: t("tabOrganisations") });
  if (can("member.manage")) tabs.push({ id: "users", label: can("member.create") ? t("tabUsers") : t("tabMembers") });
  if (can("operation.manage")) tabs.push({ id: "memberships", label: t("tabMemberships") });
  if (can("pii.purge")) tabs.push({ id: "purge", label: t("tabPurge") });
  const requested = params.get("tab");
  const tab = tabs.find((x) => x.id === requested)?.id ?? tabs[0]?.id;

  return (
    <div>
      <PageHeader title={t("adminTitle")} />
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={tab === x.id}
            onClick={() => router.replace(`/dashboard/admin?tab=${x.id}`)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === x.id ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {x.label}
          </button>
        ))}
      </div>
      {tab === "organisations" && <OrganisationsTab />}
      {tab === "users" && <UsersTab />}
      {tab === "memberships" && <MembershipsTab />}
      {tab === "purge" && <PurgeTab />}
    </div>
  );
}

function errMsg(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------

type Org = { organisationId: string; name: string; orgType: string; status: "Pending" | "Approved" | "Rejected"; rejectionReason: string | null; createdAt: string; coordinators: { userId: string; fullName: string; mobileNumber: string; status: string }[] };

function OrganisationsTab() {
  const { t, locale } = useDash();
  const [status, setStatus] = useState<Org["status"]>("Pending");
  const { data, error, loading, reload } = useApi<{ organisations: Org[] }>(`/api/organisations${qs({ status })}`);
  const [rejecting, setRejecting] = useState<Org | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function decide(org: Org, decision: "approve" | "reject") {
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/organisations/${org.organisationId}`, { method: "PATCH", body: decision === "approve" ? { decision } : { decision, rejectionReason: reason.trim() } });
      setRejecting(null);
      setReason("");
      await reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <StatusFilter value={status} onChange={(v) => setStatus(v as Org["status"])} options={["Pending", "Approved", "Rejected"]} />
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {!rejecting && <ErrorText>{actionError}</ErrorText>}
      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("orgName")}</TableHead>
              <TableHead>{t("orgType")}</TableHead>
              <TableHead>{t("registeredAt")}</TableHead>
              <TableHead>{t("coordinators")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.organisations.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-ink-muted">
                  {t("orgsEmpty")}
                </TableCell>
              </TableRow>
            )}
            {data.organisations.map((o) => (
              <TableRow key={o.organisationId}>
                <TableCell className="font-medium">{o.name}</TableCell>
                <TableCell>{o.orgType}</TableCell>
                <TableCell className="num">{fmtDateTime(o.createdAt, locale)}</TableCell>
                <TableCell>
                  {o.coordinators.map((c) => (
                    <span key={c.userId} className="block text-sm">
                      {c.fullName} <span className="num text-ink-muted">{c.mobileNumber}</span>
                    </span>
                  ))}
                </TableCell>
                <TableCell>
                  <StatusBadge status={o.status} locale={locale} />
                  {o.rejectionReason && <span className="mt-1 block text-xs text-ink-muted">{o.rejectionReason}</span>}
                </TableCell>
                <TableCell className="text-right">
                  {o.status === "Pending" && (
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => decide(o, "approve")} disabled={busy}>
                        {t("approve")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => { setRejecting(o); setActionError(null); }} disabled={busy}>
                        {t("reject")}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t("rejectTitle", { name: rejecting?.name ?? "" })}
        body={t("rejectBody")}
        confirmLabel={t("reject")}
        danger
        busy={busy}
        confirmDisabled={reason.trim().length < 5}
        error={actionError}
        onConfirm={() => rejecting && decide(rejecting, "reject")}
      >
        <label htmlFor="reject-reason" className="block text-sm font-semibold text-ink">
          {t("rejectionReason")}
        </label>
        <Textarea id="reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </div>
  );
}

function StatusFilter({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const { t, locale } = useDash();
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      {t("status")}
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "" ? t("all") : (STATUS_LABELS[o]?.[locale] ?? o)}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
}

// ---------------------------------------------------------------------------

type Member = {
  userId: string;
  fullName: string;
  mobileNumber: string;
  role: UserRole;
  status: "PendingApproval" | "Active" | "Locked" | "Deactivated";
  lockedUntil: string | null;
  organisation: { organisationId: string; name: string } | null;
  devices: { deviceId: string; deviceLabel: string; status: "Active" | "Revoked"; lastSyncAt: string | null }[];
};

type Pending = { kind: "deactivate" | "reject"; member: Member } | { kind: "revoke"; member: Member; deviceId: string; label: string } | null;

function UsersTab() {
  const { t, locale, can, user } = useDash();
  const isSys = can("member.create");
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi<{ members: Member[] }>(`/api/members${qs({ status })}`);
  const [confirm, setConfirm] = useState<Pending>(null);
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [approveRoles, setApproveRoles] = useState<Record<string, UserRole>>({});
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const roles = isSys ? ALL_ROLES : COORDINATOR_ROLES;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setConfirm(null);
      await reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }
  const patch = (m: Member, body: unknown) => api(`/api/members/${m.userId}`, { method: "PATCH", body });

  return (
    <div className="space-y-4">
      {isSys && <CreateUser onCreated={(name, password) => { setTemp({ name, password }); void reload(); }} />}
      <StatusFilter value={status} onChange={setStatus} options={["", "PendingApproval", "Active", "Locked", "Deactivated"]} />
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {!confirm && <ErrorText>{actionError}</ErrorText>}
      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("fullName")}</TableHead>
              <TableHead>{t("mobileNumber")}</TableHead>
              {isSys && <TableHead>{t("organisation")}</TableHead>}
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead>{t("devices")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-ink-muted">
                  {t("membersEmpty")}
                </TableCell>
              </TableRow>
            )}
            {data.members.map((m) => {
              const self = m.userId === user.userId;
              const manageable = !self && (isSys || COORDINATOR_ROLES.includes(m.role));
              return (
                <TableRow key={m.userId} className="align-top">
                  <TableCell className="font-medium">
                    {m.fullName} {self && <span className="text-xs text-ink-muted">{t("you")}</span>}
                  </TableCell>
                  <TableCell className="num">{m.mobileNumber}</TableCell>
                  {isSys && <TableCell>{m.organisation?.name ?? "—"}</TableCell>}
                  <TableCell>
                    {manageable && m.status !== "Deactivated" ? (
                      <NativeSelect
                        aria-label={m.status === "PendingApproval" ? t("approveAs") : t("changeRole")}
                        value={m.status === "PendingApproval" ? (approveRoles[m.userId] ?? m.role) : m.role}
                        disabled={busy}
                        onChange={(e) => {
                          const role = e.target.value as UserRole;
                          if (m.status === "PendingApproval") setApproveRoles((r) => ({ ...r, [m.userId]: role }));
                          else void run(() => patch(m, { action: "assignRole", role }).then(() => undefined));
                        }}
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r][locale]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      ROLE_LABELS[m.role][locale]
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} locale={locale} />
                    {m.status === "Locked" && m.lockedUntil && <span className="num mt-1 block text-xs text-ink-muted">→ {fmtDateTime(m.lockedUntil, locale)}</span>}
                  </TableCell>
                  <TableCell>
                    {m.devices.length === 0 && <span className="text-ink-muted">—</span>}
                    {m.devices.map((d) => (
                      <div key={d.deviceId} className="mb-1 flex items-center gap-2 text-xs">
                        <span className="min-w-0 truncate">{d.deviceLabel}</span>
                        <StatusBadge status={d.status} locale={locale} />
                        {d.lastSyncAt && <span className="num text-ink-muted">{fmtDateTime(d.lastSyncAt, locale)}</span>}
                        {d.status === "Active" && !self && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-status-danger-fg" onClick={() => { setActionError(null); setConfirm({ kind: "revoke", member: m, deviceId: d.deviceId, label: d.deviceLabel }); }}>
                            {t("revoke")}
                          </Button>
                        )}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    {manageable && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {m.status === "PendingApproval" && (
                          <>
                            <Button size="sm" disabled={busy} onClick={() => void run(() => patch(m, { action: "approve", role: approveRoles[m.userId] ?? m.role }).then(() => undefined))}>
                              {t("approve")}
                            </Button>
                            <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setActionError(null); setConfirm({ kind: "reject", member: m }); }}>
                              {t("reject")}
                            </Button>
                          </>
                        )}
                        {(m.status === "Active" || m.status === "Locked") && can("password.reset") && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const r = await api<{ temporaryPassword: string }>("/api/auth/reset-temp-password", { body: { userId: m.userId } });
                                setTemp({ name: m.fullName, password: r.temporaryPassword });
                              })
                            }
                          >
                            {t("tempPassword")}
                          </Button>
                        )}
                        {m.status !== "Deactivated" && m.status !== "PendingApproval" && (
                          <Button size="sm" variant="ghost" className="text-status-danger-fg" disabled={busy} onClick={() => { setActionError(null); setConfirm({ kind: "deactivate", member: m }); }}>
                            {t("deactivate")}
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm?.kind === "revoke" ? t("revokeTitle", { label: confirm.label }) : confirm?.kind === "reject" ? t("rejectUserTitle", { name: confirm.member.fullName }) : t("deactivateTitle", { name: confirm?.member.fullName ?? "" })
        }
        body={confirm?.kind === "revoke" ? t("revokeBody") : confirm?.kind === "reject" ? t("rejectUserBody") : t("deactivateBody")}
        confirmLabel={confirm?.kind === "revoke" ? t("revoke") : confirm?.kind === "reject" ? t("reject") : t("deactivate")}
        danger
        busy={busy}
        error={actionError}
        onConfirm={() => {
          if (!confirm) return;
          const body = confirm.kind === "revoke" ? { action: "revokeDevice", deviceId: confirm.deviceId } : { action: confirm.kind };
          void run(() => patch(confirm.member, body).then(() => undefined));
        }}
      />

      <Dialog open={temp !== null} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("tempTitle", { name: temp?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t("tempBody")}</DialogDescription>
          </DialogHeader>
          <p className="num select-all rounded-md border border-line bg-canvas px-3 py-3 text-center font-mono text-2xl font-semibold tracking-wider text-ink" data-testid="temp-password">
            {temp?.password}
          </p>
          <DialogFooter>
            <Button onClick={() => setTemp(null)}>{t("confirm")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUser({ onCreated }: { onCreated: (name: string, password: string) => void }) {
  const { t, locale } = useDash();
  const orgs = useApi<{ organisations: { organisationId: string; name: string }[] }>("/api/organisations?status=Approved");
  const [form, setForm] = useState({ fullName: "", mobileNumber: "", role: "OBSERVER" as UserRole, organisationId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Panel title={t("createUser")}>
      <p className="mb-3 text-sm text-ink-muted">{t("createUserHint")}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ temporaryPassword: string }>("/api/members", { body: { ...form, organisationId: form.organisationId || null } });
            onCreated(form.fullName, r.temporaryPassword);
            setForm({ fullName: "", mobileNumber: "", role: "OBSERVER", organisationId: "" });
          } catch (err) {
            setError(errMsg(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("fullName")}
          <Input className="h-9" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("mobileNumber")}
          <Input className="num h-9 w-36" inputMode="numeric" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value.replace(/\D/g, "").slice(0, 11) })} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("role")}
          <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}>
            {ALL_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r][locale]}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-ink-muted">
          {t("organisationOptional")}
          <NativeSelect value={form.organisationId} onChange={(e) => setForm({ ...form, organisationId: e.target.value })}>
            <option value="">{t("none")}</option>
            {orgs.data?.organisations.map((o) => (
              <option key={o.organisationId} value={o.organisationId}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </label>
        <Button type="submit" disabled={busy || form.fullName.trim().length < 2 || form.mobileNumber.length !== 11}>
          {t("createUser")}
        </Button>
      </form>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

type Membership = { organisationId: string; status: "Pending" | "Approved" | "Rejected"; requestedAt: string; reviewedAt: string | null; organisation: { name: string; orgType: string; status: string } };

function MembershipsTab() {
  const { t, locale, operation } = useDash();
  const { data, error, loading, reload } = useApi<{ memberships: Membership[] }>(operation ? `/api/operations/${operation.operationId}/setup` : null);
  const [rejecting, setRejecting] = useState<Membership | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function review(m: Membership, decision: "approve" | "reject") {
    if (!operation) return;
    setBusy(true);
    setActionError(null);
    try {
      await api(`/api/operations/${operation.operationId}/setup`, { body: { action: "reviewMembership", organisationId: m.organisationId, decision } });
      setRejecting(null);
      await reload();
    } catch (err) {
      setActionError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <LoadState loading={loading && !data} error={error} onRetry={reload} />
      {!rejecting && <ErrorText>{actionError}</ErrorText>}
      {data && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("organisation")}</TableHead>
              <TableHead>{t("orgType")}</TableHead>
              <TableHead>{t("requestedAt")}</TableHead>
              <TableHead>{t("reviewedAt")}</TableHead>
              <TableHead>{t("status")}</TableHead>
              <TableHead className="text-right">{t("actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.memberships.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-ink-muted">
                  {t("membershipsEmpty")}
                </TableCell>
              </TableRow>
            )}
            {[...data.memberships]
              .sort((a, b) => Number(b.status === "Pending") - Number(a.status === "Pending"))
              .map((m) => (
                <TableRow key={m.organisationId}>
                  <TableCell className="font-medium">{m.organisation.name}</TableCell>
                  <TableCell>{m.organisation.orgType}</TableCell>
                  <TableCell className="num">{fmtDateTime(m.requestedAt, locale)}</TableCell>
                  <TableCell className="num">{fmtDateTime(m.reviewedAt, locale)}</TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} locale={locale} />
                  </TableCell>
                  <TableCell className="text-right">
                    {m.status === "Pending" && operation?.status === "Active" && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" onClick={() => review(m, "approve")} disabled={busy}>
                          {t("approve")}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => { setActionError(null); setRejecting(m); }} disabled={busy}>
                          {t("reject")}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={t("rejectTitle", { name: rejecting?.organisation.name ?? "" })}
        body={t("rejectUserBody")}
        confirmLabel={t("reject")}
        danger
        busy={busy}
        error={actionError}
        onConfirm={() => rejecting && review(rejecting, "reject")}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

type PurgeOp = { operationId: string; name: string; closedAt: string; households: number; householdVersions?: number; auditRows?: number; purged: boolean };
type PurgeResult = { cutoff: string; dryRun: boolean; operations: PurgeOp[] };

function PurgeTab() {
  const { t, locale } = useDash();
  const ops = useApi<{ operations: { operationId: string; name: string; closedAt: string | null; piiPurgedAt: string | null }[] }>("/api/operations");
  const [preview, setPreview] = useState<PurgeResult | null>(null);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<PurgeResult>("/api/operations/pii-purge", { body: { dryRun } });
      if (dryRun) setPreview(r);
      else {
        setResult(r);
        setPreview(null);
        setConfirmOpen(false);
        await ops.reload();
      }
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  const eligibleHouseholds = preview?.operations.reduce((s, o) => s + o.households, 0) ?? 0;
  const purged = ops.data?.operations.filter((o) => o.piiPurgedAt) ?? [];
  const totals = result?.operations.reduce((s, o) => ({ households: s.households + o.households, versions: s.versions + (o.householdVersions ?? 0), audits: s.audits + (o.auditRows ?? 0) }), { households: 0, versions: 0, audits: 0 });

  return (
    <div className="space-y-4">
      <Panel title={t("purgeTitle")}>
        <p className="mb-3 text-sm text-ink-muted">{t("purgeHint")}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => call(true)} disabled={busy}>
            {t("dryRun")}
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={busy || !preview || preview.operations.length === 0}>
            {t("runPurge")}
          </Button>
        </div>
        {!confirmOpen && <div className="mt-2"><ErrorText>{error}</ErrorText></div>}
        {preview && (
          <div className="mt-4">
            {preview.operations.length === 0 ? (
              <Notice tone="neutral">{t("purgeNone")}</Notice>
            ) : (
              <>
                <h3 className="mb-2 text-sm font-semibold text-ink">{t("purgeEligible")}</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("operation")}</TableHead>
                      <TableHead>{t("closedAt")}</TableHead>
                      <TableHead className="text-right">{t("households")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.operations.map((o) => (
                      <TableRow key={o.operationId}>
                        <TableCell>{o.name}</TableCell>
                        <TableCell className="num">{fmtDateTime(o.closedAt, locale)}</TableCell>
                        <TableCell className="num text-right">{o.households}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </div>
        )}
        {totals && (
          <div className="mt-4">
            <Notice tone="ok">{t("purgeResult", { households: totals.households, versions: totals.versions, audits: totals.audits })}</Notice>
          </div>
        )}
      </Panel>
      <Panel title={t("purgedOps")}>
        {purged.length === 0 ? (
          <p className="text-sm text-ink-muted">—</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("operation")}</TableHead>
                <TableHead>{t("closedAt")}</TableHead>
                <TableHead>{t("purgedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purged.map((o) => (
                <TableRow key={o.operationId}>
                  <TableCell>{o.name}</TableCell>
                  <TableCell className="num">{fmtDateTime(o.closedAt, locale)}</TableCell>
                  <TableCell className="num">{fmtDateTime(o.piiPurgedAt, locale)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("purgeConfirmTitle")}
        body={t("purgeConfirmBody", { n: eligibleHouseholds, ops: preview?.operations.length ?? 0 })}
        confirmLabel={t("runPurge")}
        danger
        busy={busy}
        error={error}
        onConfirm={() => call(false)}
      />
    </div>
  );
}
