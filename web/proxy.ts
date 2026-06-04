import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  computeAdminSessionToken,
  getAdminSecret,
  isAdminDevUnprotected,
  isAdminMisconfiguredProduction,
} from "@/lib/admin/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
