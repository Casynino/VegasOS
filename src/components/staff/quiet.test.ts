import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sessionIsQuiet } from "@/lib/quiet";
import { QuietProvider, useQuiet } from "./quiet";

/**
 * QUIET SESSIONS (owner, 2026-10-17): a Developer's session ends after 30 minutes without use, so nothing may keep it awake on its own. Every
 * background timer of the staff application (the bell, the pages that refresh themselves, the order boards) stays off for a Developer, in the
 * console and while working as someone. Here: who is quiet, how the layout hands the flag down, and a guard that no timer is added without a decision.
 * (What the timers do when they are, and are not, quiet is in quiet-timers.test.ts; the idle clock itself is in tests/integration/developer-session-2.test.ts.)
 */
const SRC = path.resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

describe("who is quiet", () => {
  it("a Developer is — signed in as itself or working as someone (then actorType is still DEVELOPER); staff never are", () => {
    expect(sessionIsQuiet({ actorType: "DEVELOPER" })).toBe(true);
    expect(sessionIsQuiet({ actorType: "STAFF" })).toBe(false);
  });
});

describe("the flag reaches the timers", () => {
  const Probe = () => createElement("span", null, useQuiet() ? "quiet" : "loud");

  it("outside the staff layout (the public pages) nothing is quiet", () => {
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<span>loud</span>");
  });

  it("inside the provider, below any depth, the timers read what the layout said", () => {
    expect(renderToStaticMarkup(createElement(QuietProvider, { quiet: true }, createElement("div", null, createElement(Probe))))).toBe("<div><span>quiet</span></div>");
    expect(renderToStaticMarkup(createElement(QuietProvider, { quiet: false }, createElement(Probe)))).toBe("<span>loud</span>");
  });

  it("the staff shell decides it from the signed-in account and hands it to the provider and to the bell", () => {
    const shell = read("components/staff/staff-shell.tsx");
    expect(shell).toContain("sessionIsQuiet(user)");
    expect(shell).toContain("<QuietProvider quiet={quiet}>");
    expect(shell).toMatch(/<StaffAlerts[^]*?quiet=\{quiet\}/);
    expect(shell).toContain("</QuietProvider>");
  });
});

// ───────────────────────────────── no timer without a decision ─────────────────────────────────

/** Files that start a timer but do not need the flag, each with the reason. A NEW file with a timer fails the test below until it is gated (useQuiet) or listed here with its reason. */
const NOT_NEEDED: Record<string, string> = {
  "app/staff/(app)/restaurant/tables/tables-board.tsx": "a local clock that redraws the minutes; it asks the server nothing",
  "app/staff/(app)/restaurant/reservations/reservations-board.tsx": "a local clock that redraws the minutes; it asks the server nothing",
  "app/staff/(app)/restaurant/portal/portal.tsx": "a local clock; the board's polling is useLiveOrders, which is gated",
  "app/staff/(app)/restaurant/pos/pos-screen.tsx": "a local clock; it asks the server nothing",
  "app/staff/(app)/finance/withdraw/withdraw-ui.tsx": "a countdown on the screen; it asks the server nothing",
  "components/update-banner.tsx": "asks /api/version, which reads no session at all",
  "components/staff/mobile-pay.tsx": "follows a mobile-money prompt the person just sent — needs money rights the Developer is denied, so it can never start for one",
  "app/pay/[token]/pay-status.tsx": "a public payment page (a guest's token, no staff session)",
  "components/hotel-qr/confirmation.tsx": "a public guest page (no staff session)",
  "components/room-qr/breakfast.tsx": "a public guest page (no staff session)",
  "components/public/cinema/local-time.tsx": "the public site's clock; it asks the server nothing",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === "generated" || name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** A timer that keeps going: setInterval, a re-arming setTimeout poll, or a timer that refreshes the page. */
const KEEPS_GOING = /setInterval\(|setTimeout\(\s*tick\b|setTimeout\(.*router\.refresh\(/;

describe("every background timer is decided", () => {
  const files = walk(SRC);
  const withTimer = files.filter((f) => KEEPS_GOING.test(readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));

  it("finds the timers we know about (so this guard cannot pass by looking at nothing)", () => {
    for (const known of ["components/staff/staff-alerts.tsx", "components/live-refresh.tsx", "components/dashboard/command-center-list.tsx", "components/staff/sounds.ts", "components/staff/waiter-chips.tsx"]) {
      expect(withTimer, known).toContain(known);
    }
  });

  it("each file with a timer is either gated by useQuiet() or listed with the reason it needs none", () => {
    // (The bell takes the flag as a prop from the layout instead of reading it: it is not drawn at all when quiet.)
    const ungated = withTimer.filter((f) => !/useQuiet\(/.test(readFileSync(path.join(SRC, f), "utf8")) && f !== "components/staff/staff-alerts.tsx" && !(f in NOT_NEEDED));
    expect(ungated, "add useQuiet() to the timer (a Developer's session must stay quiet) or list the file in NOT_NEEDED with the reason").toEqual([]);
  });

  it("the list of exceptions has no stale entries", () => {
    for (const f of Object.keys(NOT_NEEDED)) expect(withTimer, f).toContain(f);
  });

  it("the gated files use the flag where the timer starts: the bell, both LiveRefresh components, the order boards' polling, the waiter list", () => {
    const gated = {
      "components/live-refresh.tsx": /if \(!active \|\| quiet\) return;/,
      "components/dashboard/command-center-list.tsx": /if \(quiet\) return;/,
      "components/staff/sounds.ts": /useLiveOrders[^]*?if \(quiet\) return;/,
      "components/staff/waiter-chips.tsx": /quiet \? undefined : setInterval/,
      "components/staff/staff-alerts.tsx": /if \(quiet\) return null;/,
    };
    for (const [file, pattern] of Object.entries(gated)) expect(read(file), file).toMatch(pattern);
  });
});
