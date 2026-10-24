import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast redirect for signed-out visitors to /admin. This only checks that a
 * session cookie exists; every admin page and Server Action still verifies
 * the session and role against the database (see lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && !request.cookies.has("sbs_admin")) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  const res = NextResponse.next();
  if (pathname.startsWith("/admin")) {
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return res;
}

export const config = { matcher: ["/admin/:path*"] };
