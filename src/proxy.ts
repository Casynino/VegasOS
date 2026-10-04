import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "vlh_session";
const STAFF_HINT = "vlh_staff";

/**
 * Optimistic gate only: bounces obviously signed-out requests away from the
 * staff area and exposes the pathname to layouts. Real authentication and
 * permission checks run server-side in every page and server action.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isStaffApp =
    (pathname.startsWith("/staff") && !pathname.startsWith("/staff/login")) ||
    /^\/(admin|manager|reception)(\/|$)/.test(pathname);

  if (isStaffApp && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  const res = NextResponse.next({ request: { headers } });
  // Signed out (or session expired) but the public-site hint is still there: drop it.
  if (!request.cookies.has(SESSION_COOKIE) && request.cookies.has(STAFF_HINT)) res.cookies.delete(STAFF_HINT);
  return res;
}

export const config = {
  matcher: ["/staff/:path*", "/admin/:path*", "/manager/:path*", "/reception/:path*", "/admin", "/manager", "/reception"],
};
