import type { Locale } from "./i18n/dictionary";

const TZ = "Asia/Dhaka";
const tag = (l: Locale) => (l === "bn" ? "bn-BD-u-nu-latn" : "en-GB");

export function fmtDateTime(v: string | number | Date | null | undefined, l: Locale) {
  if (v === null || v === undefined) return "—";
  return new Intl.DateTimeFormat(tag(l), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(v));
}

export function fmtDate(v: string | number | Date | null | undefined, l: Locale) {
  if (v === null || v === undefined) return "—";
  return new Intl.DateTimeFormat(tag(l), { day: "numeric", month: "short", year: "numeric", timeZone: TZ }).format(new Date(v));
}

export function fmtTime(v: string | number | Date, l: Locale) {
  return new Intl.DateTimeFormat(tag(l), { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ }).format(new Date(v));
}
