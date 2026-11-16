import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { dashTranslator, type Locale } from "@/lib/i18n/dictionary";
import { LocaleToggle } from "@/components/locale-toggle";

export function PublicShell({ locale, children, narrow = true }: { locale: Locale; children: ReactNode; narrow?: boolean }) {
  const t = dashTranslator(locale);
  return (
    <div className={cn("min-h-dvh bg-canvas", locale === "bn" && "font-bangla")}>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
          <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
            {t("appName")}
          </Link>
          <LocaleToggle locale={locale} ariaLabel="Language / ভাষা" />
        </div>
      </header>
      <main className={cn("mx-auto px-4 py-8", narrow ? "max-w-md" : "max-w-5xl")}>{children}</main>
    </div>
  );
}
