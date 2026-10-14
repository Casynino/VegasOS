import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import staffZh from "@/i18n/catalog/zh-CN/staff";
import { englishT as t, makeT } from "@/i18n/translate";
import { DEV_STRIP_VARS, IdentityBanner, IdentityCard, IdentityChip, type Identity } from "./identity-banner";

/**
 * Who is signed in, always in view (owner, 2026-10-14). A Developer sees an unmistakable strip on every staff page — "DEVELOPER MODE —
 * SUPER USER", their name, Sign out and Switch to a staff account. Staff see their own name and role in the top bar and nothing
 * about a Developer. Drawn on the server from the session; here it is drawn without the database.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = async () => {};

const developer: Identity = { actorType: "DEVELOPER", name: "Amani Developer", role: "Developer (super user)" };
const receptionist: Identity = { actorType: "STAFF", name: "Neema Reception", role: "Receptionist" };

const banner = (identity: Identity, tr = t) => renderToStaticMarkup(createElement(IdentityBanner, { identity, t: tr, signOut: noop, switchToStaff: noop }));
const chip = (identity: Identity, tr = t) => renderToStaticMarkup(createElement(IdentityChip, { identity, t: tr }));
const card = (identity: Identity, tr = t) => renderToStaticMarkup(createElement(IdentityCard, { identity, t: tr }));
const source = (file: string) => readFileSync(path.resolve(import.meta.dirname, file), "utf8");

describe("the Developer strip", () => {
  it("says DEVELOPER MODE — SUPER USER, the name, and offers Sign out and Switch to a staff account", () => {
    const html = banner(developer);
    expect(html).toContain('data-identity="developer"');
    expect(html).toContain('role="region"');
    const words = text(html);
    expect(words).toContain("DEVELOPER MODE — SUPER USER");
    expect(words).toContain("Amani Developer");
    expect(words).toContain("Sign out");
    expect(words).toContain("Switch to a staff account");
    // Two real forms with a submit button each (the server actions), not links that go nowhere.
    expect(html.match(/<form\b/g)).toHaveLength(2);
    expect(html.match(/<button type="submit"/g)).toHaveLength(2);
    // Out of print (a printed report must not carry the strip) and sticky under the shell's offset variable.
    expect(html).toContain("print:hidden");
    expect(html).toContain("var(--dev-strip)");
    expect(DEV_STRIP_VARS).toContain("--dev-strip");
  });

  it("is labelled for a screen reader with the same words", () => {
    expect(banner(developer)).toContain('aria-label="DEVELOPER MODE — SUPER USER"');
  });

  it("draws a name as plain text — a name can never inject markup into the strip", () => {
    const html = banner({ ...developer, name: `Eve <img src=x onerror=alert(1)> "Dev"` });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("is in Chinese for a Chinese-speaking Developer — the same words, still unmistakable", () => {
    const zh = makeT("zh-CN", staffZh);
    const words = text(banner(developer, zh));
    expect(words).toContain("开发者模式 — 超级用户");
    expect(words).toContain("退出登录");
    expect(words).toContain("切换到员工账号");
    expect(words).toContain("Amani Developer");
    expect(words).not.toContain("DEVELOPER MODE");
  });

  it("draws nothing for a staff account — the strip is a Developer's alone", () => {
    expect(banner(receptionist)).toBe("");
    // Even a staff identity carrying a role name that sounds like the Developer's draws no strip: the type decides, never the words.
    expect(banner({ actorType: "STAFF", name: "Not A Developer", role: "Developer (super user)" })).toBe("");
  });
});

describe("the name and role beside the picture", () => {
  it("shows a staff member's name and role, and nothing about a Developer", () => {
    const html = chip(receptionist);
    const words = text(html);
    expect(words).toBe("Neema Reception Receptionist");
    expect(html).not.toMatch(/developer|super user|fuchsia/i);
  });

  it("shows a Developer's name and role in the strip's colour, so it is never mistaken for an ordinary account's", () => {
    const html = chip(developer);
    expect(text(html)).toBe("Amani Developer Developer (super user)");
    expect(html).toContain("fuchsia");
  });

  it("translates the role's name", () => {
    const zh = makeT("zh-CN", staffZh);
    expect(text(chip(developer, zh))).toBe("Amani Developer 开发者（超级用户）");
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
    expect(text(card(developer, makeT("zh-CN", staffZh)))).toBe("Amani Developer 开发者（超级用户）");
  });

  it("keeps name and role in view on a tablet and a phone: the bottom bar's Menu card, and the shell's own tooltip", () => {
    const bar = source("bottom-bar.tsx");
    expect(bar).toContain("{user.name}");
    expect(bar).toContain("t(user.role)");
    expect(bar).toContain("lg:hidden"); // the bar is the navigation below lg — exactly where the chip is hidden
    const shell = source("staff-shell.tsx");
    expect(shell).toContain("<IdentityChip");
    expect(shell).toContain("<IdentityCard");
    expect(shell).toContain('aria-label={t("Your account — {name}, {role}"');
  });

  it("draws a name as plain text in the chip and the card", () => {
    const evil = { ...receptionist, name: `Eve <img src=x onerror=alert(1)>` };
    for (const html of [chip(evil), card(evil)]) {
      expect(html).not.toContain("<img");
      expect(html).toContain("&lt;img");
    }
  });
});
