import { z } from "zod";
import { ok, parseQuery, route } from "@/lib/api";
import { forbidden } from "@/lib/errors";
import { authenticate } from "@/lib/auth/guard";
import { can } from "@/lib/auth/rbac";
import { resolveOperation } from "@/lib/operations";
import { csvResponse, toCsv } from "@/lib/csv";
import { organisationReport, reportCsv, reportHtml, summaryReport } from "@/lib/reports";
import { uuid } from "@/lib/validation";

const query = z.object({
  type: z.enum(["organisation", "summary"]),
  operationId: uuid.optional(),
  format: z.enum(["json", "csv", "html"]).default("json"),
});

/**
 * UC-22–25 reporting.
 *  - type=organisation: Group Coordinators, own organisation only.
 *  - type=summary: Operation Administrators and Observers; strictly anonymised aggregates.
 *  - format=json | csv | html (print-ready; use the browser's Save as PDF).
 */
export const GET = route(async (req) => {
  const auth = await authenticate(req);
  const q = parseQuery(req, query);
  if (q.type === "organisation" && !can(auth.role, "report.organisation")) throw forbidden();
  if (q.type === "summary" && !can(auth.role, "report.summary")) throw forbidden();
  const op = await resolveOperation(q.operationId);
  const report = q.type === "organisation" ? await organisationReport(op, auth.organisationId!) : await summaryReport(op);

  if (q.format === "csv") {
    const { columns, rows } = reportCsv(report);
    return csvResponse(`${q.type}-report-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows, columns));
  }
  if (q.format === "html") {
    return new Response(reportHtml(report), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return ok(report);
});
