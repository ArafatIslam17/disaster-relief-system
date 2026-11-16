import Papa from "papaparse";

export type AreaInput = { upazila: string; unionName: string; ward: string };
export type CsvReject = { row: number; reason: "missing" | "length" | "duplicate" | "parse"; detail?: string };

/** Same normalisation as the server (src/app/api/operations/[id]/setup/route.ts). */
export function normaliseArea(raw: { upazila?: string; unionName?: string; ward?: string }): AreaInput | "missing" | "length" {
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/\s+/g, " ");
  const upazila = clean(raw.upazila);
  const unionName = clean(raw.unionName);
  let ward = clean(raw.ward);
  if (!upazila || !unionName || !ward) return "missing";
  if (upazila.length < 2 || upazila.length > 60 || unionName.length < 2 || unionName.length > 60 || ward.length > 10) return "length";
  ward = /^\d+$/.test(ward) ? ward.padStart(2, "0") : ward.toUpperCase();
  return { upazila, unionName, ward };
}

export const areaKey = (a: AreaInput) => `${a.upazila.toLowerCase()}|${a.unionName.toLowerCase()}|${a.ward.toLowerCase()}`;

/** Client-side preview of a CSV upload: valid rows vs rejected rows (1-based, header = row 1). */
export function previewAreaCsv(text: string, existing: AreaInput[]): { headerOk: boolean; valid: AreaInput[]; rejected: CsvReject[]; totalRows: number } {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_") });
  const fields = parsed.meta.fields ?? [];
  const unionCol = fields.includes("union_name") ? "union_name" : fields.includes("union") ? "union" : null;
  if (!fields.includes("upazila") || !unionCol || !fields.includes("ward")) return { headerOk: false, valid: [], rejected: [], totalRows: parsed.data.length };
  const seen = new Set(existing.map(areaKey));
  const valid: AreaInput[] = [];
  const rejected: CsvReject[] = [];
  parsed.data.forEach((r, i) => {
    const row = i + 2;
    const res = normaliseArea({ upazila: r.upazila, unionName: r[unionCol], ward: r.ward });
    if (typeof res === "string") return rejected.push({ row, reason: res });
    if (seen.has(areaKey(res))) return rejected.push({ row, reason: "duplicate" });
    seen.add(areaKey(res));
    valid.push(res);
  });
  for (const e of parsed.errors) rejected.push({ row: (e.row ?? 0) + 2, reason: "parse", detail: e.message });
  rejected.sort((a, b) => a.row - b.row);
  return { headerOk: true, valid, rejected, totalRows: parsed.data.length };
}

export function areasToCsv(rows: AreaInput[]) {
  return Papa.unparse({ fields: ["upazila", "union_name", "ward"], data: rows.map((r) => [r.upazila, r.unionName, r.ward]) });
}
