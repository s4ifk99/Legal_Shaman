"use client";

import { useLocale } from "@/components/i18n/locale-provider";

export function TranslationNotice({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  if (locale === "en") return null;
  return (
    <p
      role="note"
      lang={locale}
      className={
        className ??
        "rounded-md border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-950"
      }
    >
      {t.translationNotice}
    </p>
  );
}
