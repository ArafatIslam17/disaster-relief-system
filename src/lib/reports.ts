import "server-only";
import type { Operation } from "@prisma/client";
import { prisma } from "./db";
import { computeCoverage } from "./coverage";

const dhaka = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Dhaka", numberingSystem: "latn" }).format(d);

export type ItemTotal = { itemId: string; itemName: string; unit: string; quantity: number };

/** Coordinator report: everything their organisation recorded in the operation. No phone numbers. */
export async function organisationReport(op: Operation, organisationId: string) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { organisationId }, select: { name: true } });
  const [items, distributions, householdsRegistered] = await Promise.all([
    prisma.reliefItem.findMany({ where: { operationId: op.operationId }, orderBy: { itemName: "asc" } }),
    prisma.distribution.findMany({
      where: { area: { operationId: op.operationId }, recordedByUser: { organisationId } },
      include: { household: { select: { shortCode: true, memberCount: true } }, area: true, items: true, recordedByUser: { select: { fullName: true } } },
      orderBy: { distributedAt: "asc" },
    }),
    prisma.household.count({ where: { area: { operationId: op.operationId }, registeredByUser: { organisationId } } }),
  ]);
  const itemById = new Map(items.map((i) => [i.itemId, i]));
  const active = distributions.filter((d) => d.status === "Active");
  const totals: ItemTotal[] = items.map((i) => ({
    itemId: i.itemId,
    itemName: i.itemName,
    unit: i.unit,
    quantity: active.reduce((s, d) => s + (d.items.find((x) => x.itemId === i.itemId)?.quantity ?? 0), 0),
  }));
  return {
    kind: "organisation" as const,
    title: `Organisation distribution report — ${org.name}`,
    operation: { operationId: op.operationId, name: op.name, status: op.status },
    organisation: org.name,
    generatedAt: new Date().toISOString(),
    summary: {
      householdsRegistered,
      householdsServed: new Set(active.filter((d) => d.householdId).map((d) => d.householdId)).size,
      activeDistributions: active.length,
      anonymousDistributions: active.filter((d) => d.isAnonymous).length,
      voidedDistributions: distributions.length - active.length,
    },
    itemTotals: totals,
    rows: distributions.map((d) => ({
      distributedAt: dhaka(d.distributedAt),
      shortCode: d.household?.shortCode ?? "Anonymous",
      memberCount: d.household?.memberCount ?? "",
      upazila: d.area.upazila,
      union: d.area.unionName,
      ward: d.area.ward,
      items: d.items.map((x) => `${itemById.get(x.itemId)?.itemName ?? x.itemId} × ${x.quantity}`).join("; "),
      recordedBy: d.recordedByUser.fullName,
      status: d.status,
      cancelReason: d.cancelReason ?? "",
    })),
  };
}

/** Admin/Observer report: aggregates only — no names, phone numbers, short codes or volunteer names. */
export async function summaryReport(op: Operation) {
  const [coverage, items, lines, orgs] = await Promise.all([
    computeCoverage(op.operationId),
    prisma.reliefItem.findMany({ where: { operationId: op.operationId }, orderBy: { itemName: "asc" } }),
    prisma.distributionItem.findMany({
      where: { distribution: { status: "Active", area: { operationId: op.operationId } } },
      select: { itemId: true, quantity: true, distribution: { select: { areaId: true } } },
    }),
    prisma.operationMembership.findMany({ where: { operationId: op.operationId, status: "Approved" }, include: { organisation: { select: { organisationId: true, name: true } } } }),
  ]);
  const qty = new Map<string, number>(); // `${areaId}:${itemId}`
  for (const l of lines) {
    const k = `${l.distribution.areaId}:${l.itemId}`;
    qty.set(k, (qty.get(k) ?? 0) + l.quantity);
  }
  const byOrg = await Promise.all(
    orgs.map(async (m) => {
      const where = { status: "Active" as const, area: { operationId: op.operationId }, recordedByUser: { organisationId: m.organisationId } };
      const [distributions, served] = await Promise.all([
        prisma.distribution.count({ where }),
        prisma.distribution.findMany({ where: { ...where, householdId: { not: null } }, distinct: ["householdId"], select: { householdId: true } }),
      ]);
      return { organisation: m.organisation.name, activeDistributions: distributions, householdsServed: served.length };
    }),
  );
  return {
    kind: "summary" as const,
    title: "Operation summary report (anonymised)",
    operation: { operationId: op.operationId, name: op.name, status: op.status },
    generatedAt: new Date().toISOString(),
    items: items.map((i) => ({ itemId: i.itemId, itemName: i.itemName, unit: i.unit })),
    areas: coverage.map((a) => ({
      upazila: a.upazila,
      union: a.unionName,
      ward: a.ward,
      registered: a.registered,
      served: a.served,
      unserved: a.unserved,
      anonymousDistributions: a.anonymousDistributions,
      status: a.label.en,
      itemQuantities: Object.fromEntries(items.map((i) => [i.itemName, qty.get(`${a.areaId}:${i.itemId}`) ?? 0])),
    })),
    itemTotals: items.map((i) => ({ itemId: i.itemId, itemName: i.itemName, unit: i.unit, quantity: lines.filter((l) => l.itemId === i.itemId).reduce((s, l) => s + l.quantity, 0) })),
    organisations: byOrg,
  };
}

export type OrganisationReport = Awaited<ReturnType<typeof organisationReport>>;
export type SummaryReport = Awaited<ReturnType<typeof summaryReport>>;

export function reportCsv(r: OrganisationReport | SummaryReport): { columns: string[]; rows: Record<string, unknown>[] } {
  if (r.kind === "organisation") {
    return {
      columns: ["distributedAt", "shortCode", "memberCount", "upazila", "union", "ward", "items", "recordedBy", "status", "cancelReason"],
      rows: r.rows,
    };
  }
  const itemCols = r.items.map((i) => `${i.itemName} (${i.unit})`);
  return {
    columns: ["upazila", "union", "ward", "registered", "served", "unserved", "anonymousDistributions", "status", ...itemCols],
    rows: r.areas.map((a) => {
      const row: Record<string, unknown> = { ...a };
      delete row.itemQuantities;
      r.items.forEach((i, idx) => (row[itemCols[idx]] = a.itemQuantities[i.itemName]));
      return row;
    }),
  };
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function table(columns: string[], rows: Record<string, unknown>[], numeric: Set<string>) {
  const head = columns.map((c) => `<th${numeric.has(c) ? ' class="n"' : ""}>${esc(c)}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td${numeric.has(c) ? ' class="n"' : ""}>${esc(r[c])}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${columns.length}">No records.</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Self-contained print-ready document (A4). Use the browser's "Save as PDF". */
export function reportHtml(r: OrganisationReport | SummaryReport): string {
  const { columns, rows } = reportCsv(r);
  const numeric = new Set(columns.filter((c) => rows.some((row) => typeof row[c] === "number")));
  const totals = table(
    ["Item", "Unit", "Quantity distributed"],
    r.itemTotals.map((t) => ({ Item: t.itemName, Unit: t.unit, "Quantity distributed": t.quantity })),
    new Set(["Quantity distributed"]),
  );
  const extra =
    r.kind === "organisation"
      ? table(Object.keys(r.summary), [r.summary], new Set(Object.keys(r.summary)))
      : `<h2>By organisation</h2>${table(["organisation", "activeDistributions", "householdsServed"], r.organisations, new Set(["activeDistributions", "householdsServed"]))}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  :root { --ink:#0F172A; --muted:#475569; --line:#CBD5E1; --canvas:#F8FAFC; --primary:#0F766E; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; font: 12px/1.45 Inter, "Hind Siliguri", system-ui, sans-serif; color: var(--ink); background: #fff; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; }
  h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 20px 0 8px; }
  .meta { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-variant-numeric: tabular-nums; }
  th, td { border: 1px solid var(--line); padding: 5px 7px; text-align: left; vertical-align: top; }
  th { background: var(--canvas); font-size: 11px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
  .n { text-align: right; }
  button { font: inherit; background: var(--primary); color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; cursor: pointer; }
  @media print { body { padding: 0; } button { display: none; } thead { display: table-header-group; } tr { break-inside: avoid; } }
</style></head>
<body>
<header>
  <div><h1>${esc(r.title)}</h1>
  <div class="meta">${esc(r.operation.name)} · Status: ${esc(r.operation.status)} · Generated ${esc(dhaka(new Date(r.generatedAt)))} (Asia/Dhaka)</div></div>
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
</header>
${extra}
<h2>Item totals (active distributions)</h2>
${totals}
<h2>${r.kind === "organisation" ? "Distributions" : "Coverage by area"}</h2>
${table(columns, rows, numeric)}
</body></html>`;
}
