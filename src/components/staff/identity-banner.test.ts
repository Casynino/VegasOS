import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import commonZh from "@/i18n/catalog/zh-CN/common";
import staffZh from "@/i18n/catalog/zh-CN/staff";
import shellZh from "@/i18n/catalog/zh-CN/staff/developer-shell";
import { englishT as t, makeT } from "@/i18n/translate";
import { IdentityBanner, IdentityCard, IdentityChip, WORK_AS_HOURS, spanWords, stripVars, workAsClock, type Identity } from "./identity-banner";

/**
 * Who is signed in, always in view. THREE states:
 *  - staff: their own name and role in the menus, no strip;
 *  - a Developer signed in as itself: nothing (no strip);
 *  - a Developer WORKING AS someone: one small floating pill "Working as {name}" with a Stop button (time left in its tooltip) — on
 *    every page, phone, tablet and computer; it takes no room in the page.
 * All drawn on the server from the session; here they are drawn without the database.
 */
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = async () => {};
// (the role names are in the common bundle; developer-shell is merged by hand until the bundle index is rebuilt)
const zh = makeT("zh-CN", { ...commonZh, ...staffZh, ...shellZh });

const STARTED = new Date("2026-10-17T08:00:00Z");
const developer: Identity = { actorType: "DEVELOPER", name: "Amani Developer", role: "Developer (super user)" };
const receptionist: Identity = { actorType: "STAFF", name: "Neema Reception", role: "Receptionist" };
/** The Developer working as Neema: name / role are Neema's, and workAs says who is really signed in. */
const workingAs: Identity = { actorType: "DEVELOPER", name: "Neema Reception", role: "Receptionist", workAs: { developerName: "Amani Developer", startedAt: STARTED } };
const at = (minutesAfterStart: number) => new Date(STARTED.getTime() + minutesAfterStart * 60_000);

const banner = (identity: Identity, tr = t, now?: Date) => renderToStaticMarkup(createElement(IdentityBanner, { identity, t: tr, stopWorkAs: noop, now }));
const chip = (identity: Identity, tr = t) => renderToStaticMarkup(createElement(IdentityChip, { identity, t: tr }));
const card = (identity: Identity, tr = t) => renderToStaticMarkup(createElement(IdentityCard, { identity, t: tr }));
const source = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("state 1 — staff: no strip, their own name and role", () => {
  it("draws nothing for a staff account — the strip is a Developer's alone", () => {
    expect(banner(receptionist)).toBe("");
    // Even a staff identity carrying a role name that sounds like the Developer's draws no strip: the type decides, never the words.
    expect(banner({ actorType: "STAFF", name: "Not A Developer", role: "Developer (super user)" })).toBe("");
    // ... and a staff identity cannot be given a work-as strip either.
    expect(banner({ ...receptionist, workAs: { developerName: "X", startedAt: STARTED } })).toBe("");
    expect(stripVars(receptionist)).toBe("");
  });

  it("shows a staff member's name and role, and nothing about a Developer", () => {
    const html = chip(receptionist);
    expect(text(html)).toBe("Neema Reception Receptionist");
    expect(html).not.toMatch(/developer|super user|fuchsia/i);
  });
});

describe("state 2 — a Developer signed in as itself (in its own console)", () => {
  it("draws no strip at all (the console's side menu says where you are), and adds no height to the page", () => {
    expect(banner(developer)).toBe("");
    expect(stripVars(developer)).toBe("");
  });
});

describe("state 3 — a Developer WORKING AS someone", () => {
  it("is one small pill: 'Working as {name}' and a Stop button, with the time left in its tooltip", () => {
    const html = banner(workingAs, t, at(12));
    expect(html).toContain('data-identity="work-as"');
    expect(html).toContain('role="region"');
    expect(text(html)).toBe("Working as Neema Reception Stop");
    // one real form with one submit button: Stop (the server action) — not a link that goes nowhere; no Sign out here (it is in the side menu)
    expect(html.match(/<form\b/g)).toHaveLength(1);
    expect(html.match(/<button type="submit"/g)).toHaveLength(1);
    expect(html).toMatch(/<button type="submit" data-work-as-stop[^>]*>Stop<\/button>/);
    expect(html).not.toContain("Sign out");
    expect(html).toContain('aria-label="Working as Neema Reception"');
    expect(html).toContain('title="Neema Reception (Receptionist) · started 12 min ago · ends in 3 h 48 min"');
  });

  it("floats over the page (fixed, bottom right, above the phone's bottom bar), is out of print and adds no height to the page", () => {
    const html = banner(workingAs, t, at(5));
    expect(html).toContain("fixed bottom-20 right-3");
    expect(html).toContain("lg:bottom-5 lg:right-5");
    expect(html).toContain("print:hidden");
    expect(html).not.toContain("sticky");
    expect(stripVars(workingAs)).toBe("");
    expect(stripVars(developer)).toBe("");
  });

  it("counts the time from when it started and from the 4-hour end — never negative", () => {
    expect(WORK_AS_HOURS).toBe(4);
    expect(workAsClock(STARTED, at(0))).toEqual({ elapsedMs: 0, leftMs: 4 * 3_600_000 });
    expect(workAsClock(STARTED, at(90))).toEqual({ elapsedMs: 90 * 60_000, leftMs: 150 * 60_000 });
    expect(workAsClock(STARTED, at(240))).toEqual({ elapsedMs: 240 * 60_000, leftMs: 0 });
    expect(workAsClock(STARTED, at(300)).leftMs).toBe(0);
    expect(workAsClock(STARTED, at(-5)).elapsedMs).toBe(0); // a clock a little behind never shows minus
    // a start time given as text (it crossed from the server) works the same
    expect(workAsClock(STARTED.toISOString(), at(30))).toEqual(workAsClock(STARTED, at(30)));
  });

  it("says the span in plain words", () => {
    expect(spanWords(20_000, t)).toBe("less than a minute");
    expect(spanWords(59 * 60_000, t)).toBe("59 min");
    expect(spanWords(60 * 60_000, t)).toBe("1 h");
    expect(spanWords(228 * 60_000, t)).toBe("3 h 48 min");
    expect(banner(workingAs, t, at(0))).toContain("started less than a minute ago · ends in 4 h");
    expect(banner(workingAs, t, at(239))).toContain("started 3 h 59 min ago · ends in 1 min");
  });

  it("draws the person's name and role as plain text — a name can never inject markup", () => {
    const html = banner({ ...workingAs, name: `Eve <img src=x onerror=alert(1)>`, role: `<b>Boss</b>` }, t, at(1));
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>Boss");
    expect(html).toContain("&lt;img");
  });

  it("is in Chinese for a Chinese-speaking person — same pill, same Stop", () => {
    const html = banner(workingAs, zh, at(12));
    expect(text(html)).toBe("正在以 Neema Reception 的身份操作 停止");
    expect(html).toContain("已开始 12 分钟");
    expect(html).not.toContain("Working as");
  });

  it("the menus show the PERSON being worked as — the Developer's own name is never the account shown", () => {
    // The chip in the top bar and the card in the side menu: Neema's name and role, in the Developer colour (a Developer is signed in).
    expect(text(chip(workingAs))).toBe("Neema Reception Receptionist");
    expect(chip(workingAs)).not.toContain("Amani");
    expect(text(card(workingAs))).toBe("Neema Reception Receptionist");
    expect(card(workingAs)).not.toContain("Amani");
    // The card goes nowhere while working as someone (their account page is theirs); for anybody else it opens the account page.
    expect(card(workingAs)).not.toContain("href=");
    expect(card(receptionist)).toContain('href="/staff/account"');
    expect(card(developer)).toContain('href="/staff/account"');
  });
});

describe("the top bar keeps room for the date and the search", () => {
  const classOf = (html: string, attr: string) => new RegExp(`${attr}[^>]*class="([^"]*)"|class="([^"]*)"[^>]*${attr}`).exec(html)?.slice(1).find(Boolean) ?? "";

  it("shows the chip from lg up (name only at lg), never on a phone or a tablet", () => {
    const cls = classOf(chip(receptionist), "data-identity-chip").split(" ");
    expect(cls).toContain("hidden");
    expect(cls).toContain("lg:block");
    // The old chip appeared from md (tablet) and took about 140px there.
    expect(cls).not.toContain("md:block");
    // A short name box at lg, the wider one only from xl.
    expect(cls).toContain("max-w-[7rem]");
    expect(cls).toContain("xl:max-w-[12rem]");
  });

  it("shows the role line only from xl — at lg the role is in the tooltip", () => {
    const html = chip(receptionist);
    const role = classOf(html, "data-identity-role").split(" ");
    expect(role).toContain("hidden");
    expect(role).toContain("xl:block");
    expect(html).toContain('title="Neema Reception · Receptionist — your account"');
  });

  it("puts the same name and role in a card in the side menu at laptop width (hidden from xl, where the top bar has both)", () => {
    const html = card(receptionist);
    expect(text(html)).toBe("Neema Reception Receptionist");
    expect(html).toContain('href="/staff/account"');
    expect(classOf(html, "data-identity-card").split(" ")).toContain("xl:hidden");
    expect(html).not.toMatch(/developer|super user|fuchsia/i);
    // A Developer's card carries the strip's colour.
    expect(card(developer)).toContain("fuchsia");
    expect(text(card(developer, zh))).toBe("Amani Developer 开发者（超级用户）");
  });

  it("draws a name as plain text in the chip and the card", () => {
    const evil = { ...receptionist, name: `Eve <img src=x onerror=alert(1)>` };
    for (const html of [chip(evil), card(evil)]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    }
  });
});

describe("the shell and the phone's Menu use them", () => {
  it("keeps name and role in view on a tablet and a phone: the bottom bar's Menu card, and the shell's own tooltip", () => {
    const bar = source("bottom-bar.tsx");
    expect(bar).toContain("{user.name}");
    expect(bar).toContain("t(user.role)");
    expect(bar).toContain("lg:hidden"); // the bar is the navigation below lg — exactly where the chip is hidden
    // While working as someone the phone's Menu says so too, and its card goes nowhere.
    expect(bar).toContain("user.workAs");
    const shell = source("staff-shell.tsx");
    expect(shell).toContain("<IdentityChip");
    expect(shell).toContain("<IdentityCard");
    expect(shell).toContain('aria-label={t("Your account — {name}, {role}"');
  });

  it("the shell draws the pill from the session's work-as record, with Stop wired to the Access page's action, on every page", () => {
    const shell = source("staff-shell.tsx");
    // Server-rendered from the session — the identity comes from requireUser(), never from client state, a cookie or the page.
    expect(shell).toContain("await requireUser()");
    expect(shell).toContain("user.workAs");
    expect(shell).toContain("stopWorkAs={stopWorkAsAction}");
    expect(shell).toContain('from "@/app/staff/(app)/developer/access/actions"');
    expect(shell).toContain("stripVars(identity)");
    // No client state in the banner: it is a server component.
    const banner = source("identity-banner.tsx");
    expect(banner).not.toMatch(/"use client"|useState|useEffect|localStorage|sessionStorage|document\.cookie/);
    // The sticky parts below the strip keep using its offset variable.
    expect(shell).toContain("top-[var(--dev-strip,0px)]");
  });

  it("while working as someone the language switch (their account) is hidden and the bell is not drawn at all (a Developer's session is quiet); the Developer console shows its own tabs", () => {
    const shell = source("staff-shell.tsx");
    expect(shell).toContain("{!workAs && <LanguageSwitch");
    expect(shell).toContain("quiet={quiet}");
    expect(shell).toContain("console={consoleMode}");
    // A receptionist's "No active shift" reminder is not shown for the person being worked as (the shift gate is skipped then).
    expect(shell).toContain("const noShift = !workAs");
  });
});
