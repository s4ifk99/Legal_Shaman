export const LOCALE_CODES = ["en", "cy", "pl", "ur", "bn", "ar", "ro"] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];

export const NON_ENGLISH_LOCALES = ["cy", "pl", "ur", "bn", "ar", "ro"] as const;

export type LocaleMeta = {
  code: LocaleCode;
  html: string;
  label: string;
  dir: "ltr" | "rtl";
};

export const LOCALES: readonly LocaleMeta[] = [
  { code: "en", html: "en-GB", label: "English", dir: "ltr" },
  { code: "cy", html: "cy", label: "Cymraeg", dir: "ltr" },
  { code: "pl", html: "pl", label: "Polski", dir: "ltr" },
  { code: "ur", html: "ur", label: "اردو", dir: "rtl" },
  { code: "bn", html: "bn", label: "বাংলা", dir: "ltr" },
  { code: "ar", html: "ar", label: "العربية", dir: "rtl" },
  { code: "ro", html: "ro", label: "Română", dir: "ltr" },
];

const NON_ENGLISH = new Set<string>(NON_ENGLISH_LOCALES);

export function isLocaleCode(value: string | null | undefined): value is LocaleCode {
  return Boolean(value && (value === "en" || NON_ENGLISH.has(value)));
}

export function localeMeta(code: LocaleCode): LocaleMeta {
  return LOCALES.find((locale) => locale.code === code) ?? LOCALES[0];
}

export function stripLocalePrefix(pathname: string): string {
  const bare = pathname.replace(/^\/(cy|pl|ur|bn|ar|ro)(?=\/|$)/, "");
  return bare || "/";
}

export function localePath(locale: LocaleCode, pathname: string): string {
  const raw = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const cutAt = [raw.indexOf("?"), raw.indexOf("#")].filter((index) => index >= 0);
  const cut = cutAt.length ? Math.min(...cutAt) : raw.length;
  const bare = stripLocalePrefix(raw.slice(0, cut));
  const suffix = raw.slice(cut);
  if (locale === "en") return `${bare}${suffix}`;
  return `/${locale}${bare === "/" ? "" : bare}${suffix}`;
}

export function languageAlternates(pathname: string): Record<string, string> {
  const bare = stripLocalePrefix(pathname.split(/[?#]/)[0] || "/");
  return Object.fromEntries(LOCALES.map((locale) => [locale.html, localePath(locale.code, bare)]));
}
