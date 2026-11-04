import { headers } from "next/headers";
import { isLocaleCode, type LocaleCode } from "@/lib/i18n/locales";

export async function getRequestLocale(): Promise<LocaleCode> {
  const headerStore = await headers();
  const value = headerStore.get("x-locale");
  return isLocaleCode(value) ? value : "en";
}
