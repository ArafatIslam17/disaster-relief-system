import { Badge } from "@/components/ui/badge";
import { STATUS_LABELS, type Locale } from "@/lib/i18n/dictionary";

type Tone = "pending" | "ok" | "danger" | "neutral";

/** Single source of truth for state → colour. Mirrors CLAUDE.md §2 and State Diagrams 01–06. */
export const STATUS_TONE: Record<string, Tone> = {
  Pending: "pending",
  Uploading: "pending",
  PendingApproval: "pending",
  PendingReview: "pending",

  Acknowledged: "ok",
  Active: "ok",
  Approved: "ok",
  Resolved: "ok",
  Linked: "ok",
  Justified: "ok",
  Served: "ok",

  Open: "danger",
  Failed: "danger",
  Locked: "danger",
  Rejected: "danger",
  Voided: "danger",
  Repeat: "danger",
  Revoked: "danger",

  Closed: "neutral",
  Deactivated: "neutral",
  NotDuplicate: "neutral",
  Unserved: "neutral",
  NoRecords: "neutral",
};

export type StatusKey = keyof typeof STATUS_TONE;

/** `bilingual` renders "English / বাংলা" regardless of the UI locale (coverage status labels). */
export function StatusBadge({ status, locale, bilingual = false }: { status: StatusKey; locale: Locale; bilingual?: boolean }) {
  const tone = STATUS_TONE[status];
  if (!tone) throw new Error(`StatusBadge: unmapped status "${status}". Add it to STATUS_TONE and STATUS_LABELS.`);
  const labels = STATUS_LABELS[status];
  const label = bilingual && labels ? `${labels.en} / ${labels.bn}` : (labels?.[locale] ?? status);
  return (
    <Badge tone={tone} className={bilingual || locale === "bn" ? "font-bangla" : undefined}>
      {label}
    </Badge>
  );
}
