import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/i18n/client";
import staffZh from "@/i18n/catalog/zh-CN/staff";
import type { LoginState } from "./actions";

// The form is drawn without the server action behind it (which needs the database): only its own words are stubbed.
vi.mock("./actions", () => ({ loginAction: vi.fn() }));
// The page's own surroundings (who is signed in, the hotel's settings, the visitor's language) are stubbed.
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
import { LoginFormView } from "./login-form-view";

/**
 * The sign-in form (owner, 2026-10-17): ONE door, as simple as a normal user's — an email, a password with a show / hide button, and
 * Sign in. No choice of "Developer" or "Staff", nothing about account types, no ?as= address. What matters here is what the person
 * SEES: the plain form, the one plain error after a wrong try, and never a password coming back into the page.
 */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const noop = () => {};

const view = (state: LoginState = undefined, pending = false) => renderToStaticMarkup(createElement(LoginFormView, { state, pending, action: noop }));
const WRONG = "Incorrect email or password.";

describe("the one door", () => {
  it("is a plain email + password form with a Sign in button and a show / hide password button — nothing else to choose", () => {
    const html = view();
    const words = text(html);
    expect(words).toContain("Email");
    expect(words).toContain("Password");
    expect(words).toContain("Sign in");
    expect(html).toMatch(/<input[^>]*id="email"[^>]*type="email"|<input[^>]*type="email"[^>]*id="email"/);
    expect(html).toMatch(/<input[^>]*id="password"[^>]*type="password"|<input[^>]*type="password"[^>]*id="password"/);
    expect(html).toContain('aria-label="Show password"');
    expect(html).toMatch(/<button type="submit"/);
    // exactly two named fields: no door, no account type, no radio, no fieldset
    expect(html.match(/<input\b/g)).toHaveLength(2);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("<fieldset");
    expect(html).not.toContain("accountType");
  });

  it("says nothing about Developers or account types anywhere in the form", () => {
    const words = text(view({ error: WRONG, email: "a@example.test" }));
    expect(words).not.toMatch(/developer|account type|staff account|super user/i);
  });

  it("keeps the email after a wrong try, shows the one plain error, and never gives the password back", () => {
    const html = view({ error: WRONG, email: "dev.person@example.test" });
    expect(html).toMatch(/<input[^>]*id="email"[^>]*value="dev\.person@example\.test"/);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain(WRONG);
    const password = html.match(/<input[^>]*id="password"[^>]*>/)?.[0] ?? "";
    expect(password).toContain('type="password"');
    expect(password).not.toContain("value=");
  });

  it("draws an email with quotes or tags as plain text", () => {
    const html = view({ error: WRONG, email: `"><script>alert(1)</script>@x.test` });
    // (React adds its own form-replay script after a form; what matters is that the typed text never becomes markup.)
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;@x.test"');
  });

  it("with no error there is no alert", () => {
    expect(view()).not.toContain('role="alert"');
  });
});

describe("while it is being sent", () => {
  it("disables the button, and says so", () => {
    const html = view(undefined, true);
    expect(html).toMatch(/<button type="submit"[^>]*disabled/);
    expect(text(html)).toContain("Signing in…");
  });
});

describe("the form in the page", () => {
  it("LoginForm is the same plain form (it takes no choice of door)", () => {
    const html = renderToStaticMarkup(createElement(LoginForm));
    expect(html.match(/<input\b/g)).toHaveLength(2);
    expect(html).not.toContain('type="radio"');
    expect(text(html)).toContain("Sign in");
  });

  it("is in Chinese for a Chinese-speaking visitor", () => {
    // (children as a prop: createElement's typing wants it there for this component)
    // eslint-disable-next-line react/no-children-prop
    const html = renderToStaticMarkup(createElement(I18nProvider, { locale: "zh-CN", catalog: staffZh, children: createElement(LoginFormView, { state: { error: "Incorrect email or password.", email: "a@x.test" }, pending: false, action: noop }) }));
    const words = text(html);
    expect(words).toContain("邮箱");
    expect(words).toContain("密码");
    expect(words).toContain("登录");
    expect(words).not.toContain("Sign in");
  });
});

describe("the sign-in page", () => {
  const page = async () => renderToStaticMarkup(await LoginPage());

  it("is the plain staff sign-in: the form, the welcome and the hotel — no Developer door, no ?as= address", async () => {
    const html = await page();
    const words = text(html);
    expect(words).toContain("Sign in");
    expect(words).toContain("Staff access only");
    expect(words).toContain("Forgot your password? Ask the hotel administrator.");
    expect(words).not.toMatch(/developer|account type|super user/i);
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("accountType");
    expect(html.match(/<input\b/g)).toHaveLength(2);
    // the page takes no search parameters at all any more
    expect(LoginPage.length).toBe(0);
  });

  it("a person already signed in (a Developer too) is sent on to /staff, which opens their own home", async () => {
    signedIn.user = { id: "u1" };
    try { await expect(page()).rejects.toThrow("REDIRECT /staff"); } finally { signedIn.user = null; }
  });
});
