/**
 * Bilingual UI dictionary (NFR18). Every user-facing string lives here.
 * Data values (short_code, mobile_number, head_name, score, counts) are never translated
 * and always render with Latin digits + `num` (tabular-nums) so they can be read back aloud
 * and typed into a phone without transliteration.
 */
export const LOCALES = ["en", "bn"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "bn";
}

const en = {
  appName: "Relief Coordination",
  operation: "Operation",
  activeOperation: "Active operation",
  noActiveOperation: "No active operation. An Operation Administrator must create one.",
  coverage: "Area coverage",
  coverageHint: "Households registered and served per ward. Wards with no registrations need a field team.",
  upazila: "Upazila",
  union: "Union",
  ward: "Ward",
  registered: "Registered",
  served: "Served",
  unserved: "Unserved",
  anonymous: "Anonymous",
  status: "Status",
  started: "Started",
  disasterType: "Disaster type",
  language: "Language",
} as const;

export type MessageKey = keyof typeof en;

const bn: Record<MessageKey, string> = {
  appName: "ত্রাণ সমন্বয়",
  operation: "কার্যক্রম",
  activeOperation: "চলমান কার্যক্রম",
  noActiveOperation: "কোনো চলমান কার্যক্রম নেই। একজন অপারেশন অ্যাডমিনিস্ট্রেটরকে এটি তৈরি করতে হবে।",
  coverage: "এলাকাভিত্তিক কভারেজ",
  coverageHint: "প্রতি ওয়ার্ডে নিবন্ধিত ও ত্রাণপ্রাপ্ত পরিবার। যে ওয়ার্ডে কোনো নিবন্ধন নেই সেখানে মাঠকর্মী দল প্রয়োজন।",
  upazila: "উপজেলা",
  union: "ইউনিয়ন",
  ward: "ওয়ার্ড",
  registered: "নিবন্ধিত",
  served: "ত্রাণপ্রাপ্ত",
  unserved: "ত্রাণবঞ্চিত",
  anonymous: "বেনামি",
  status: "অবস্থা",
  started: "শুরু",
  disasterType: "দুর্যোগের ধরন",
  language: "ভাষা",
};

export const messages: Record<Locale, Record<MessageKey, string>> = { en, bn };

export function translator(locale: Locale) {
  return (key: MessageKey) => messages[locale][key];
}

/** Status labels — keys are the exact enum values from prisma/schema.prisma plus client-only sync states. */
export const STATUS_LABELS: Record<string, Record<Locale, string>> = {
  Pending: { en: "Pending", bn: "অপেক্ষমাণ" },
  Uploading: { en: "Uploading", bn: "আপলোড হচ্ছে" },
  PendingApproval: { en: "Pending approval", bn: "অনুমোদনের অপেক্ষায়" },
  PendingReview: { en: "Pending review", bn: "পর্যালোচনার অপেক্ষায়" },
  Acknowledged: { en: "Acknowledged", bn: "গৃহীত" },
  Active: { en: "Active", bn: "সক্রিয়" },
  Approved: { en: "Approved", bn: "অনুমোদিত" },
  Resolved: { en: "Resolved", bn: "নিষ্পন্ন" },
  Linked: { en: "Linked", bn: "সংযুক্ত" },
  Justified: { en: "Justified", bn: "যৌক্তিক" },
  Served: { en: "Served", bn: "ত্রাণপ্রাপ্ত" },
  Open: { en: "Open", bn: "অমীমাংসিত" },
  Failed: { en: "Failed (retryable)", bn: "ব্যর্থ (পুনরায় চেষ্টাযোগ্য)" },
  Locked: { en: "Locked", bn: "লক করা" },
  Rejected: { en: "Rejected", bn: "প্রত্যাখ্যাত" },
  Voided: { en: "Voided", bn: "বাতিলকৃত" },
  Repeat: { en: "Repeat", bn: "পুনরাবৃত্তি" },
  Revoked: { en: "Revoked", bn: "প্রত্যাহারকৃত" },
  Closed: { en: "Closed", bn: "সমাপ্ত" },
  Deactivated: { en: "Deactivated", bn: "নিষ্ক্রিয়" },
  NotDuplicate: { en: "Not duplicate", bn: "ডুপ্লিকেট নয়" },
  Unserved: { en: "Unserved", bn: "ত্রাণবঞ্চিত" },
  NoRecords: { en: "No Records", bn: "কোনো রেকর্ড নেই" },
};

/** Administrative place names used on coverage labels. Unknown names fall back to English. */
export const PLACE_NAMES_BN: Record<string, string> = {
  "Feni Sadar": "ফেনী সদর",
  Parshuram: "পরশুরাম",
  Fazilpur: "ফাজিলপুর",
  Dharmapur: "ধর্মপুর",
  Kazirbag: "কাজিরবাগ",
  Chhagalnaiya: "ছাগলনাইয়া",
  Mirzanagar: "মির্জানগর",
  Chithalia: "চিথলিয়া",
};

export function placeName(name: string, locale: Locale): string {
  return locale === "bn" ? (PLACE_NAMES_BN[name] ?? name) : name;
}
