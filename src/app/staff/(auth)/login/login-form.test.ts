import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/client";
import staffZh from "@/i18n/catalog/zh-CN/staff";
import type { LoginState } from "./actions";

// The form is drawn without the server action behind it (which needs the database): only its own words are stubbed.
vi.mock("./actions", () => ({ loginAction: vi.fn() }));
// The page's own surroundings (who is signed in, the hotel's settings, the visitor's language) are stubbed: it is the ?as= choice that is tested.
const signedIn = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => signedIn.user }));
vi.mock("@/server/settings", () => ({ getSettings: async () => ({ hotelName: "Vegas Luxury Hotel", city: "Dar es Salaam" }) }));
vi.mock("@/components/public/contact", () => ({ addressLines: () => ["Mlimani City", "Dar es Salaam"] }));
vi.mock("@/i18n/server", async () => {
  const { englishT } = await import("@/i18n/translate");
  return { guestLocale: async () => "en", getT: async () => englishT };
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));

import LoginPage from "./page";
import { LoginForm } from "./login-form";
import { LoginFormView, type AccountType } from "./login-form-view";

/**
 * The sign-in form's two doors (owner, 2026-10-14): Staff account and Developer account. The door is only a choice — the server
 * checks the account itself — so what matters here is what the person SEES: both choices, the one they picked kept after a wrong
 * password, the address's ?as=developer picking the Developer door, and never a password coming back into the page.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

const view = (state: LoginState = undefined, initialType?: AccountType, pending = false) =>
  renderToStaticMarkup(createElement(LoginFormView, { state, pending, action: noop, initialType }));

/** The radio for a door, as written in the page (attribute order is React's). */
const radio = (html: string, value: AccountType) => html.match(new RegExp(`<input[^>]*name="accountType"[^>]*value="${value}"[^>]*>`))?.[0] ?? "";
const isChecked = (html: string, value: AccountType) => /checked/.test(radio(html, value));
const DEVELOPER_NOTICE = "Developer sign-in — every action is recorded as a Developer action.";

describe("the two doors", () => {
  it("shows both choices, with their words, as one group of radio buttons", () => {
    const html = view();
    expect(html).toContain("<fieldset");
    const words = text(html);
    expect(words).toContain("Account type");
    expect(words).toContain("Staff account");
    expect(words).toContain("Developer account");
    expect(html.match(/name="accountType"/g)).toHaveLength(2);
    expect(radio(html, "STAFF")).toContain('type="radio"');
    expect(radio(html, "DEVELOPER")).toContain('type="radio"');
  });

  it("opens on Staff account when nothing else is said, with no Developer notice", () => {
    const html = view();
    expect(isChecked(html, "STAFF")).toBe(true);
    expect(isChecked(html, "DEVELOPER")).toBe(false);
    expect(text(html)).not.toContain(DEVELOPER_NOTICE);
  });

  it("?as=developer preselects the Developer door and says what it means", () => {
    const html = view(undefined, "DEVELOPER");
    expect(isChecked(html, "DEVELOPER")).toBe(true);
    expect(isChecked(html, "STAFF")).toBe(false);
    expect(text(html)).toContain(DEVELOPER_NOTICE);
  });

  it("?as=staff (or anything else) is the Staff door", () => {
    expect(isChecked(view(undefined, "STAFF"), "STAFF")).toBe(true);
  });
});

describe("after a wrong try", () => {
  const wrong = "Incorrect email or password for this account type.";

  it("keeps the chosen door and the email, shows the one plain error, and never gives the password back", () => {
    const html = view({ error: wrong, email: "dev.person@example.test", accountType: "DEVELOPER" });
    expect(isChecked(html, "DEVELOPER")).toBe(true);
    expect(isChecked(html, "STAFF")).toBe(false);
    expect(html).toMatch(/<input[^>]*id="email"[^>]*value="dev\.person@example\.test"/);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(wrong);
    const password = html.match(/<input[^>]*id="password"[^>]*>/)?.[0] ?? "";
    expect(password).toContain('type="password"');
    expect(password).not.toContain("value=");
    expect(text(html)).toContain(DEVELOPER_NOTICE);
  });

  it("keeps the Staff door too, even when the address said ?as=developer (the last try wins over the address)", () => {
    const html = view({ error: wrong, email: "staff.person@example.test", accountType: "STAFF" }, "DEVELOPER");
    expect(isChecked(html, "STAFF")).toBe(true);
    expect(isChecked(html, "DEVELOPER")).toBe(false);
    expect(text(html)).not.toContain(DEVELOPER_NOTICE);
  });

  it("says nothing different for the two doors — the error never hints which part was wrong", () => {
    const staff = text(view({ error: wrong, email: "a@example.test", accountType: "STAFF" }));
    const dev = text(view({ error: wrong, email: "a@example.test", accountType: "DEVELOPER" }));
    expect(staff).toContain(wrong);
    expect(dev).toContain(wrong);
    for (const html of [staff, dev]) expect(html).not.toMatch(/no such|not found|does not exist|wrong password|wrong email|not a developer/i);
  });

  it("draws an email with quotes or tags as plain text", () => {
    const html = view({ error: wrong, email: `"><script>alert(1)</script>@x.test`, accountType: "STAFF" });
    // (React adds its own form-replay script after a form; what matters is that the typed text never becomes markup.)
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@x.test"');
  });

  it("with no error there is no alert", () => {
    expect(view()).not.toContain('role="alert"');
  });
});

describe("while it is being sent", () => {
  it("disables the choices and the button, and says so", () => {
    const html = view(undefined, "DEVELOPER", true);
    expect(radio(html, "STAFF")).toContain("disabled");
    expect(radio(html, "DEVELOPER")).toContain("disabled");
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
    expect(text(html)).toContain("Signing in…");
  });
});

describe("the form in the page", () => {
  it("LoginForm passes the address's choice on (?as=developer → the Developer door)", () => {
    const dev = renderToStaticMarkup(createElement(LoginForm, { initialType: "DEVELOPER" }));
    expect(isChecked(dev, "DEVELOPER")).toBe(true);
    const staff = renderToStaticMarkup(createElement(LoginForm, {}));
    expect(isChecked(staff, "STAFF")).toBe(true);
    expect(isChecked(staff, "DEVELOPER")).toBe(false);
  });

  it("is in Chinese for a Chinese-speaking visitor — both doors named, the notice too", () => {
    // (children as a prop: createElement's typing wants it there for this component)
    // eslint-disable-next-line react/no-children-prop
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: "zh-CN", catalog: staffZh, children: createElement(LoginFormView, { state: undefined, pending: false, action: noop, initialType: "DEVELOPER" }) }));
    const words = text(html);
    expect(words).toContain("账号类型");
    expect(words).toContain("员工账号");
    expect(words).toContain("开发者账号");
    expect(words).toContain("开发者登录 — 每一步操作都会记为开发者操作。");
    expect(words).not.toContain("Developer account");
  });
});

describe("the sign-in page and its ?as= address", () => {
  const page = async (as?: string | string[]) => renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve(as === undefined ? {} : { as }) }));

  it("offers both doors, and opens on Staff", async () => {
    const html = await page();
    expect(isChecked(html, "STAFF")).toBe(true);
    expect(isChecked(html, "DEVELOPER")).toBe(false);
    expect(text(html)).toContain("Developer account");
  });

  it("?as=developer opens on the Developer door — a choice only, nothing is signed in by it", async () => {
    const html = await page("developer");
    expect(isChecked(html, "DEVELOPER")).toBe(true);
    expect(isChecked(html, "STAFF")).toBe(false);
  });

  it("any other ?as= (or a repeated one) is the Staff door", async () => {
    for (const as of ["staff", "Developer", "admin", "", ["developer", "staff"]]) {
      const html = await page(as);
      expect(isChecked(html, "STAFF"), String(as)).toBe(true);
      expect(isChecked(html, "DEVELOPER"), String(as)).toBe(false);
    }
  });

  it("a person already signed in is sent on, whichever door the address names", async () => {
    signedIn.user = { id: "u1" };
    try { await expect(page("developer")).rejects.toThrow("REDIRECT /staff"); } finally { signedIn.user = null; }
  });
});
