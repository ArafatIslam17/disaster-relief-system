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

export function StatusBadge({ status, locale }: { status: StatusKey; locale: Locale }) {
  const tone = STATUS_TONE[status];
  if (!tone) throw new Error(`StatusBadge: unmapped status "${status}". Add it to STATUS_TONE and STATUS_LABELS.`);
  const label = STATUS_LABELS[status]?.[locale] ?? status;
  return (
    <Badge tone={tone} className={locale === "bn" ? "font-bangla" : undefined}>
      {label}
    </Badge>
  );
}
