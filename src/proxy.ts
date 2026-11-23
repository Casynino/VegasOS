import { NextResponse, type NextRequest } from "next/server";

/**
 * SYSTEM OFFLINE SWITCH (owner, 2026-11-23).
 * While OFFLINE is true the WHOLE system — public website, staff dashboard, guest links AND the API — answers every
 * request with a plain "temporarily offline" page (HTTP 503). No other proxy logic runs; nothing is read, changed or
 * deleted. To bring the system back online: set OFFLINE to false AND restore the original matcher at the bottom of
 * this file (both are swapped together — `git revert` of the offline commit also does both).
 */
const OFFLINE = true;
const OFFLINE_MESSAGE = "This system is temporarily offline. Please contact the developer (Nino)";
function offlinePage() {
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8"/>` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/>` +
    `<title>Temporarily offline</title><style>:root{color-scheme:dark}*{margin:0;box-sizing:border-box}` +
    `html,body{height:100%}body{background:#0c0a07;color:#ece7db;` +
    `font:400 clamp(16px,2.6vw,19px)/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;` +
    `display:grid;place-items:center;padding:24px;text-align:center}main{max-width:30rem}` +
    `.dot{width:9px;height:9px;border-radius:50%;background:#c9a227;display:inline-block;margin-bottom:22px;` +
    `box-shadow:0 0 0 6px rgba(201,162,39,.14)}p{text-wrap:balance}</style></head>` +
    `<body><main><span class="dot"></span><p>${OFFLINE_MESSAGE}</p></main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "retry-after": "3600",
    },
  });
}

const SESSION_COOKIE = "vlh_session";
const STAFF_HINT = "vlh_staff";

// Languages (kept in step with src/i18n/config.ts — the proxy stays dependency-free).
const LOCALE_COOKIE = "vlh-lang";
const SEGMENTS: Record<string, string> = { en: "en", "zh-CN": "zh" };
const toLocale = (v: string | null | undefined) => {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "en" || s.startsWith("en-")) return "en";
  if (s === "zh" || s === "cn" || s.startsWith("zh-") || s.startsWith("zh_")) return "zh-CN";
  return null;
};
/** The website's pages (they live under /[lang]; their addresses never show it). */
const WEBSITE = /^\/(?:$|(?:rooms|book|booking|contact|gallery|hotel|meeting-room|menu|restaurant|bar|transport|verify)(?:\/|$))/;
const PREFIXED = /^\/(en|zh)(\/.*)?$/;
const YEAR = 60 * 60 * 24 * 365;

function remember(res: NextResponse, locale: string) {
  res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: YEAR, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return res;
}

/**
 * Optimistic gate only: bounces obviously signed-out requests away from the
 * staff area and exposes the pathname to layouts. Real authentication and
 * permission checks run server-side in every page and server action.
 *
 * Languages (presentation only — never part of any access decision): the website keeps its addresses (/rooms, QR
 * links, WhatsApp links all unchanged) and is served from the visitor's language version (/en/rooms or /zh/rooms
 * inside the app, each cached). The language is the visitor's own choice (cookie), else a Chinese phone → Chinese,
 * else English. `?lang=zh` on any guest link, or an /zh/… address, is a choice: remembered, then the clean address.
 */
export function proxy(request: NextRequest) {
  // System offline: every request gets the "temporarily offline" page, nothing else runs. See the switch at the top.
  if (OFFLINE) return offlinePage();

  const { pathname, searchParams } = request.nextUrl;

  // An explicit choice in the address: remember it and go to the clean address.
  const asked = request.method === "GET" ? toLocale(searchParams.get("lang")) : null;
  const prefixed = PREFIXED.exec(pathname);
  if (asked || prefixed) {
    const url = request.nextUrl.clone();
    url.searchParams.delete("lang");
    if (prefixed) url.pathname = prefixed[2] || "/";
    return remember(NextResponse.redirect(url), asked ?? toLocale(prefixed![1]) ?? "en");
  }

  if (WEBSITE.test(pathname)) {
    const chosen = toLocale(request.cookies.get(LOCALE_COOKIE)?.value);
    const phone = toLocale(request.headers.get("accept-language")?.split(",")[0]);
    const locale = chosen ?? (phone === "zh-CN" ? "zh-CN" : "en");
    const url = request.nextUrl.clone();
    url.pathname = `/${SEGMENTS[locale]}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }

  const isStaffApp =
    (pathname.startsWith("/staff") && !pathname.startsWith("/staff/login")) ||
    /^\/(admin|manager|reception|finance)(\/|$)/.test(pathname);

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

// While the system is OFFLINE the proxy must run on EVERY route (the normal matcher below only covers some of them),
// so nothing slips through. To bring the system back online, set OFFLINE = false above and restore the ORIGINAL
// matcher kept in the comment underneath this one.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/* ORIGINAL MATCHER — when bringing the system back online, replace the catch-all config above with this one:
export const config = {
  matcher: [
    "/staff/:path*", "/admin/:path*", "/manager/:path*", "/reception/:path*", "/finance/:path*", "/admin", "/manager", "/reception", "/finance",
    // The website (served per language) and its language addresses.
    "/", "/rooms/:path*", "/book/:path*", "/booking/:path*", "/contact/:path*", "/gallery/:path*", "/hotel/:path*",
    "/meeting-room/:path*", "/menu/:path*", "/restaurant/:path*", "/bar/:path*", "/transport/:path*", "/verify/:path*",
    "/en", "/en/:path*", "/zh", "/zh/:path*",
    // Guest pages and report links: only for ?lang= (their language: the visitor's choice, then the guest's saved one).
    "/b/:path*", "/order/:path*", "/order", "/pay/:path*", "/stay/:path*", "/r/:path*", "/spin/:path*", "/t/:path*", "/thanks/:path*",
    "/staff-report/:path*", "/shift-report/:path*", "/daily-report/:path*",
  ],
};
*/
