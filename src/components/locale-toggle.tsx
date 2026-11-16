"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/dictionary";

const OPTIONS: { value: Locale; label: string }[] = [
  { value: "en", label: "EN" },
  { value: "bn", label: "বাংলা" },
];

export function LocaleToggle({ locale, ariaLabel }: { locale: Locale; ariaLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = next;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-busy={pending}
      className="inline-flex h-8 overflow-hidden rounded-md border border-line bg-surface text-xs font-semibold"
    >
      {OPTIONS.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={locale === o.value}
          onClick={() => choose(o.value)}
          className={cn(
            "px-3",
            i > 0 && "border-l border-line",
            o.value === "bn" && "font-bangla",
            locale === o.value ? "bg-primary text-primary-fg" : "text-ink-muted hover:bg-canvas",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
