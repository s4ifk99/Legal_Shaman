import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  computeAdminSessionToken,
  getAdminSecret,
  isAdminDevUnprotected,
  isAdminMisconfiguredProduction,
} from "@/lib/admin/auth";
import { isLocaleCode, localePath, stripLocalePrefix } from "@/lib/i18n/locales";
import { isMaintenanceMode, MAINTENANCE_MESSAGE } from "@/lib/maintenance";

const LOCALE_COOKIE = "ls_locale";

function skipsLocale(pathname: string): boolean {
  return (
    pathname.startsWith("/api") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/embed") ||
    pathname === "/maintenance" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt"
  );
}

function withLocaleHeader(request: NextRequest, locale: string): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-locale", locale);
  return headers;
}

function localeResponse(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  const bare = stripLocalePrefix(pathname);
  if (skipsLocale(bare)) {
    if (pathname !== bare) {
      const url = request.nextUrl.clone();
      url.pathname = bare;
      return NextResponse.redirect(url);
    }
    return null;
  }

  if (request.nextUrl.searchParams.get("lang") === "en") {
    const url = request.nextUrl.clone();
    url.pathname = bare;
    url.searchParams.delete("lang");
    const res = NextResponse.redirect(url);
    res.cookies.set(LOCALE_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const prefixed = pathname.match(/^\/(cy|pl|ur|bn|ar|ro)(?=\/|$)/);
  if (prefixed) {
    const locale = prefixed[1];
    const url = request.nextUrl.clone();
    url.pathname = bare;
    const res = NextResponse.rewrite(url, { request: { headers: withLocaleHeader(request, locale) } });
    res.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return res;
  }

  const saved = request.cookies.get(LOCALE_COOKIE)?.value;
  const canRedirect = request.method === "GET" || request.method === "HEAD";
  if (
    canRedirect &&
    saved &&
    isLocaleCode(saved) &&
    saved !== "en" &&
    !bare.endsWith("/markdown") &&
    !request.headers.has("next-action")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = localePath(saved, bare);
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: withLocaleHeader(request, "en") } });
}

function isMaintenanceExempt(pathname: string): boolean {
  return (
    pathname === "/maintenance" ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/api/admin")
  );
}

function maintenanceResponse(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, must-revalidate",
      },
    });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "maintenance", message: MAINTENANCE_MESSAGE },
      {
        status: 503,
        headers: {
          "retry-after": "172800",
          "cache-control": "no-store, must-revalidate",
        },
      },
    );
  }

  const url = request.nextUrl.clone();
  url.pathname = "/maintenance";
  url.search = "";
  const res = NextResponse.rewrite(url);
  res.headers.set("Retry-After", "172800");
  res.headers.set("Cache-Control", "no-store, must-revalidate");
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isMaintenanceMode() && !isMaintenanceExempt(pathname)) {
    return maintenanceResponse(request);
  }

  if (pathname === "/maintenance") {
    const home = request.nextUrl.clone();
    home.pathname = "/";
    home.search = "";
    return NextResponse.redirect(home);
  }

  if (pathname === "/embed/signpost" || stripLocalePrefix(pathname) === "/embed/signpost") {
    const res = NextResponse.next();
    res.headers.delete("X-Frame-Options");
    res.headers.set("Content-Security-Policy", "frame-ancestors *");
    return res;
  }

  const localized = localeResponse(request);
  if (localized) return localized;

  if (!pathname.startsWith("/admin") && !pathname.startsWith("/api/admin")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin/login") || pathname.startsWith("/api/admin/session")) {
    return NextResponse.next();
  }

  if (isAdminMisconfiguredProduction()) {
    if (pathname.startsWith("/api/admin")) {
      return NextResponse.json(
        { error: "ADMIN_SECRET is not configured; admin APIs are disabled in production." },
        { status: 503 },
      );
    }
    return new NextResponse(
      "Admin area disabled: set ADMIN_SECRET in the server environment before deploying.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  if (isAdminDevUnprotected()) {
    const res = NextResponse.next();
    res.headers.set("x-admin-auth-warning", "development-without-admin-secret");
    return res;
  }

  const secret = getAdminSecret()!;
  const cookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const header = request.headers.get("x-admin-secret");
  const expected = await computeAdminSessionToken(secret);

  if (pathname.startsWith("/api/admin")) {
    if (header === secret || cookie === expected) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (cookie === expected) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/admin/login";
  url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
