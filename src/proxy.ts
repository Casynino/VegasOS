import { NextResponse, type NextRequest } from "next/server";

/**
 * SYSTEM OFFLINE SWITCH (owner, 2026-11-23).
 * While OFFLINE is true the WHOLE system — public website, staff dashboard, guest links AND the API — answers every
 * request with a plain "temporarily offline" page (HTTP 503). No other proxy logic runs; nothing is read, changed or
 * deleted. To bring the system back online: set OFFLINE to false AND restore the original matcher at the bottom of
 * this file (both are swapped together — `git revert` of the offline commit also does both).
 */
const OFFLINE = true;
const OFFLINE_MESSAGE = "The system is offline.";
const OFFLINE_SUB = "Contact Nino.";

// The hotel-night scene from the sign-in page, rebuilt compactly so the offline page can carry it inline (the proxy
// runs at the edge and cannot import the React scene). Fixed numbers only, so it draws the same every time.
const OFFLINE_STARS = Array.from({ length: 22 }, (_, i) => {
  const x = (i * 79 + 13) % 100, y = (i * 47 + 7) % 44, delay = (i % 3) * 0.7;
  return `<i style="left:${x}%;top:${y}%;animation-delay:-${delay}s"></i>`;
}).join("");
const OFFLINE_WINDOWS = (() => {
  const towers: [cols: number[], top: number, mod: number][] = [
    [[758, 782, 806, 830], 126, 3], // the hotel tower (most lit)
    [[648, 672, 696], 236, 4], // left neighbour
    [[900, 924, 948], 200, 4], // right neighbour
  ];
  let d = "";
  for (const [cols, top, mod] of towers)
    for (let y = top; y <= 414; y += 26) for (const x of cols) if ((x + y) % mod !== 0) d += `M${x} ${y}h6v9h-6z`;
  return d;
})();
function offlinePage() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/><meta name="robots" content="noindex"/><meta name="theme-color" content="#0a0805"/><title>System offline</title><style>
*{margin:0;box-sizing:border-box}:root{color-scheme:dark}html,body{height:100%}
body{min-height:100svh;background:#0a0805;color:#f2ece0;font:400 clamp(15px,2.6vw,18px)/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:26vh 24px 24px;text-align:center;overflow:hidden;position:relative}
.scene{position:fixed;inset:0;z-index:0;overflow:hidden;background:radial-gradient(760px 460px at 0% 0%,rgba(22,70,74,.30),transparent 62%),radial-gradient(900px 540px at 80% -6%,rgba(246,214,138,.15),transparent 62%),radial-gradient(760px 480px at 6% 98%,rgba(150,96,40,.20),transparent 62%),linear-gradient(180deg,#0a0805 0%,#110c07 52%,#1a1209 100%)}
.glow{position:absolute;border-radius:50%;filter:blur(8px);opacity:.85}
.glow.a{width:46vmax;height:46vmax;left:-8vmax;top:-14vmax;background:radial-gradient(closest-side,rgba(246,214,138,.20),transparent);animation:dA 24s ease-in-out infinite alternate}
.glow.b{width:40vmax;height:40vmax;right:-10vmax;top:-6vmax;background:radial-gradient(closest-side,rgba(176,108,40,.18),transparent);animation:dB 30s ease-in-out infinite alternate}
@keyframes dA{to{transform:translate(6vmax,4vmax)}}@keyframes dB{to{transform:translate(-5vmax,5vmax)}}
.stars{position:absolute;inset:0 0 50% 0}
.stars i{position:absolute;width:2px;height:2px;border-radius:50%;background:#fff3d6;opacity:.5;animation:tw 6s ease-in-out infinite}
@keyframes tw{0%,100%{opacity:.22}50%{opacity:.9}}
.beam{position:absolute;bottom:15%;width:40vmax;height:48vmax;transform-origin:bottom center;background:linear-gradient(0deg,rgba(246,214,138,.5),rgba(246,214,138,.12) 48%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 38%,#000 62%,transparent);mask-image:linear-gradient(90deg,transparent,#000 38%,#000 62%,transparent);opacity:.45}
.beam.l{left:14%;animation:sL 15s ease-in-out infinite alternate}
.beam.r{left:60%;animation:sR 19s ease-in-out -7s infinite alternate}
@keyframes sL{from{transform:rotate(-16deg)}to{transform:rotate(10deg)}}@keyframes sR{from{transform:rotate(14deg)}to{transform:rotate(-12deg)}}
.sky{position:absolute;left:0;right:0;bottom:15%;height:min(38vh,300px)}
.sky svg{width:100%;height:100%;display:block}
.beacon{animation:bl 2.6s ease-in-out infinite}@keyframes bl{0%,100%{opacity:1}50%{opacity:.25}}
.horizon{position:absolute;left:0;right:0;bottom:calc(15% - 1px);height:2px;background:linear-gradient(90deg,transparent,rgba(246,214,138,.85) 28%,#f6d68a 50%,rgba(246,214,138,.85) 72%,transparent)}
.floor{position:absolute;left:0;right:0;bottom:0;height:15%;background:linear-gradient(180deg,rgba(246,214,138,.06),rgba(8,6,3,.82))}
.vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 42%,transparent 54%,rgba(5,4,2,.66)),linear-gradient(180deg,rgba(8,6,3,.5),transparent 26%)}
main{position:relative;z-index:2;width:min(92vw,34rem);animation:up .9s cubic-bezier(.2,.7,.2,1) both}
main::before{content:"";position:absolute;inset:-30px -54px;z-index:-1;background:radial-gradient(66% 90% at 50% 50%,rgba(6,5,3,.84),rgba(6,5,3,.48) 56%,transparent 80%)}
.pin{width:10px;height:10px;border-radius:50%;background:#f6d68a;display:inline-block;margin-bottom:22px;box-shadow:0 0 0 7px rgba(246,214,138,.12),0 0 20px rgba(246,214,138,.65)}
.msg{font-size:clamp(20px,5vw,32px);font-weight:700;letter-spacing:-.015em;color:#fff7ea;white-space:nowrap;text-shadow:0 2px 10px rgba(0,0,0,.9),0 1px 34px rgba(0,0,0,.65)}
.sub{margin-top:10px;font-size:clamp(16px,3.4vw,21px);font-weight:600;color:#efe4cf;white-space:nowrap;text-shadow:0 2px 10px rgba(0,0,0,.9),0 1px 30px rgba(0,0,0,.6)}
@keyframes up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.stars i{opacity:.6}}
</style></head><body><div class="scene"><span class="glow a"></span><span class="glow b"></span><div class="stars">${OFFLINE_STARS}</div><span class="beam l"></span><span class="beam r"></span><div class="sky"><svg viewBox="0 0 1600 440" preserveAspectRatio="xMidYMax slice" aria-hidden="true"><path d="M-20 440V372h150V440zM130 440V392h120V440zM250 440V352h150V440zM400 440V382h130V440zM530 440V336h150V440zM680 440V318h170V440zM850 440V330h160V440zM1010 440V360h140V440zM1150 440V340h150V440zM1300 440V380h160V440zM1460 440V360h170V440z" fill="#1c160d"/><path d="M738 440V100h124V440zM628 440V210h96V440zM876 440V175h104V440zM548 440V280h74V440zM986 440V250h84V440zM462 440V318h76V440zM1076 440V302h78V440zM372 440V344h84V440zM1160 440V324h90V440zM270 440V356h92V440zM1256 440V338h80V440zM176 440V374h84V440zM1348 440V362h90V440zM752 100V76h96v24zM774 76V58h52v18zM799 58V22h2v36z" fill="#0c0905"/><rect x="748" y="82" width="104" height="10" fill="#f6d68a" fill-opacity=".12"/><rect x="752" y="86" width="96" height="2" fill="#f6d68a" fill-opacity=".85"/><path d="${OFFLINE_WINDOWS}" fill="#f6d68a"/><circle cx="800" cy="20" r="3" fill="#ffe3a3" class="beacon"/></svg></div><div class="horizon"></div><div class="floor"></div><div class="vig"></div></div><main><span class="pin"></span><p class="msg">${OFFLINE_MESSAGE}</p><p class="sub">${OFFLINE_SUB}</p></main></body></html>`;
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
