"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { LOCALES, localePath, type LocaleCode } from "@/lib/i18n/locales";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  clearListen,
  ListenButton,
  primeSpeech,
  rememberListen,
  startSpeaking,
  stopSpeaking,
  useQueuedListen,
  useSpeaking,
} from "@/components/i18n/read-aloud";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ className }: { className?: string }) {
  const pathname = usePathname() || "/";
  const search = useSearchParams();
  const { locale, t } = useLocale();
  const speaking = useSpeaking();
  useQueuedListen(locale);

  function hrefFor(code: LocaleCode): string {
    const base = localePath(code, pathname);
    const params = new URLSearchParams(search.toString());
    params.delete("lang");
    if (code === "en") params.set("lang", "en");
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }

  function onListen(code: LocaleCode) {
    if (speaking === code) {
      clearListen();
      stopSpeaking();
      return;
    }
    if (code === locale) {
      clearListen();
      primeSpeech();
      startSpeaking(code);
      return;
    }
    rememberListen(code);
    window.location.assign(hrefFor(code));
  }

  return (
    <nav aria-label={t.language} data-no-read className={className}>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        {LOCALES.map((item) => (
          <li key={item.code} className="inline-flex items-center gap-1">
            <a
              href={hrefFor(item.code)}
              hrefLang={item.html}
              lang={item.html}
              aria-current={item.code === locale ? "page" : undefined}
              onClick={() => clearListen()}
              className={cn(
                "underline-offset-2 hover:underline",
                item.code === locale ? "font-semibold text-foreground" : "text-muted-foreground",
              )}
            >
              {item.label}
            </a>
            <ListenButton code={item.code} pressed={speaking === item.code} onPress={() => onListen(item.code)} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
