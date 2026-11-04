"use client";

import { createContext, useContext } from "react";
import { fill, messagesFor, translateParentCategory, translateSectionTitle, type Messages } from "@/lib/i18n/messages";
import { localeMeta, localePath, type LocaleCode } from "@/lib/i18n/locales";

const LocaleContext = createContext<LocaleCode>("en");

export function LocaleProvider({ locale, children }: { locale: LocaleCode; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const locale = useContext(LocaleContext);
  const t = messagesFor(locale);
  return {
    locale,
    t,
    meta: localeMeta(locale),
    path: (pathname: string) => localePath(locale, pathname),
    fill: (template: string, values: Record<string, string | number>) => fill(template, values),
    sectionTitle: (title: string) => translateSectionTitle(locale, title),
    parentCategory: (name: string) => translateParentCategory(locale, name),
  };
}

export type { Messages };
