import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getCurrentUser } from "@/server/auth";
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeFromSegment, toLocale, type Locale } from "./config";
import { loadCatalog, type Bundle } from "./catalog";
import { makeT, type Catalog, type T } from "./translate";
import { db } from "@/server/db";
import CONTENT_ZH from "./content/zh-CN";

/**
 * WHOSE LANGUAGE (server side). In order:
 *   1. the page said so — setRequestLocale(): the website's /[lang] pages, a guest page for its guest
 *   2. a signed-in staff member → their own preference (User.preferredLanguage)
 *   3. the visitor's own choice (cookie)
 *   4. English
 * Language is presentation only: it never decides who may see or do anything.
 */
const requestStore = cache((): { locale: Locale | null; area: "public" | null } => ({ locale: null, area: null }));

/** Pages and layouts call this first (each one: they can render in any order). */
export function setRequestLocale(locale: Locale, area?: "public") {
  requestStore().locale = locale;
  if (area) requestStore().area = area;
}

export async function getLocale(): Promise<Locale> {
  const set = requestStore().locale;
  if (set) return set;
  const user = await getCurrentUser().catch(() => null);
  if (user) return toLocale(user.locale) ?? DEFAULT_LOCALE;
  return (await visitorLocale()) ?? DEFAULT_LOCALE;
}

/** The visitor's own choice on this device (null when they never picked one). */
export async function visitorLocale(): Promise<Locale | null> {
  try {
    return toLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch {
    return null; // outside a request (a job, a test)
  }
}

/**
 * A guest page (QR menus, stay link, order tracking, payment, thank-you, Hotel QR): the visitor's own choice on this
 * device, else a phone set to Chinese → Chinese, else English. A staff member's account language never applies here
 * (a receptionist opening a guest's link sees what the guest sees). Links in a Chinese guest's WhatsApp messages carry
 * ?lang=zh, which the proxy remembers as their choice. Cached per request; call it first in the layout AND the page.
 */
export const guestLocale = cache(async (): Promise<Locale> => {
  let locale = await visitorLocale();
  if (!locale) {
    try {
      const first = (await headers()).get("accept-language")?.split(",")[0];
      locale = toLocale(first) === "zh-CN" ? "zh-CN" : null;
    } catch { /* outside a request */ }
  }
  const l = locale ?? DEFAULT_LOCALE;
  setRequestLocale(l, "public");
  return l;
});

/**
 * The hotel's own content (dish and category names, room types, amenities, services, transport) by its English
 * text: the translations staff saved (MenuItemTranslation…) over the built-in defaults (i18n/content). Merged into
 * the same lookup as the interface, so `t(item.name)` shows a dish in the person's language anywhere. Kept for a
 * minute (and dropped when a translation is saved).
 */
const CONTENT_TTL = 60_000;
let contentMemo: { at: number; locale: Locale; map: Promise<Catalog> } | null = null;
export function forgetContentTranslations() {
  contentMemo = null;
}
async function savedContent(locale: Locale): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const put = (en: string | null | undefined, tr: string | null | undefined) => {
    if (en && tr && tr.trim()) out[en.trim()] = tr.trim();
  };
  const where = { locale };
  const [items, cats, rooms, amen, svc, trs, opts] = await Promise.all([
    db.menuItemTranslation.findMany({ where, select: { name: true, description: true, parent: { select: { name: true, description: true } } } }),
    db.menuCategoryTranslation.findMany({ where, select: { name: true, description: true, parent: { select: { name: true, description: true } } } }),
    db.roomTypeTranslation.findMany({ where, select: { name: true, shortDescription: true, description: true, bedType: true, parent: { select: { name: true, shortDescription: true, description: true, bedType: true } } } }),
    db.amenityTranslation.findMany({ where, select: { name: true, parent: { select: { name: true } } } }),
    db.hotelServiceTranslation.findMany({ where, select: { name: true, description: true, priceNote: true, parent: { select: { name: true, description: true, priceNote: true } } } }),
    db.transportServiceTranslation.findMany({ where, select: { name: true, description: true, parent: { select: { name: true, description: true } } } }),
    db.transportServiceOptionTranslation.findMany({ where, select: { name: true, description: true, parent: { select: { name: true, description: true } } } }),
  ]);
  for (const r of [...items, ...cats, ...trs, ...opts]) { put(r.parent.name, r.name); put(r.parent.description, r.description); }
  for (const r of rooms) { put(r.parent.name, r.name); put(r.parent.shortDescription, r.shortDescription); put(r.parent.description, r.description); put(r.parent.bedType, r.bedType); }
  for (const r of amen) put(r.parent.name, r.name);
  for (const r of svc) { put(r.parent.name, r.name); put(r.parent.description, r.description); put(r.parent.priceNote, r.priceNote); }
  return out;
}
function contentCatalog(locale: Locale): Promise<Catalog> {
  if (locale === DEFAULT_LOCALE) return Promise.resolve({});
  if (contentMemo && contentMemo.locale === locale && Date.now() - contentMemo.at < CONTENT_TTL) return contentMemo.map;
  const seed: Record<string, string> = locale === "zh-CN" ? CONTENT_ZH : {};
  const map = savedContent(locale)
    .then((saved) => Object.freeze({ ...seed, ...saved }) as Catalog)
    .catch(() => Object.freeze({ ...seed }) as Catalog);
  contentMemo = { at: Date.now(), locale, map };
  return map;
}

async function fullCatalog(locale: Locale, bundles: Bundle[]): Promise<Catalog> {
  if (locale === DEFAULT_LOCALE) return {};
  const [ui, content] = await Promise.all([loadCatalog(locale, bundles), contentCatalog(locale)]);
  return { ...content, ...ui };
}

/**
 * The same English can need different words for guests and for staff ("Served", "Book", "From"…): on the website and
 * guest pages the guests' wording wins, everywhere else the staff wording (server text — errors, messages — last).
 */
const ORDER = {
  public: ["common", "staff", "server", "public"] as Bundle[],
  staff: ["common", "public", "staff", "server"] as Bundle[],
};
const tFor = cache(async (locale: Locale, area: keyof typeof ORDER): Promise<T> => makeT(locale, await fullCatalog(locale, ORDER[area])));

/** The translator for whoever this request is for. */
export async function getT(): Promise<T> {
  const locale = await getLocale();
  return tFor(locale, requestStore().area ?? "staff");
}

/** A translator for a given language — WhatsApp messages and reports go out in the RECIPIENT's language. */
export async function getTFor(locale: string | null | undefined, area: keyof typeof ORDER = "staff"): Promise<T> {
  const l = toLocale(locale) ?? DEFAULT_LOCALE;
  return makeT(l, await fullCatalog(l, ORDER[area]));
}

/** The strings a browser needs for this language (for <I18nProvider>): only these bundles (+ the hotel's content), nothing for English. */
export async function clientCatalog(locale: Locale, bundles: Bundle[]): Promise<Catalog | null> {
  return locale === DEFAULT_LOCALE ? null : fullCatalog(locale, ["common", ...bundles.filter((b) => b !== "common" && b !== "server")]);
}

/**
 * A website page under /[lang] (the proxy maps /rooms → /en/rooms or /zh/rooms from the visitor's choice): sets the
 * language for everything this page renders. Call it first in each page, layout and generateMetadata.
 */
export async function pageLocale(params: Promise<{ lang: string }> | { lang: string }): Promise<Locale> {
  const { lang } = await params;
  const locale = localeFromSegment(lang) ?? DEFAULT_LOCALE;
  setRequestLocale(locale, "public");
  return locale;
}

/**
 * Save a customer's language on their record when they CHOSE one on this device (the switcher, a ?lang= link) — at
 * the moment they book, order or pay. A language guessed from the phone is never saved, and nothing is changed when
 * they made no choice. Their pages and WhatsApp messages then follow it. Never throws.
 */
export async function rememberGuestLanguage(guestId: string | null | undefined, tx: { guest: { updateMany: typeof db.guest.updateMany } } = db) {
  if (!guestId) return;
  try {
    const chosen = await visitorLocale();
    if (chosen) await tx.guest.updateMany({ where: { id: guestId, NOT: { preferredLanguage: chosen } }, data: { preferredLanguage: chosen } });
  } catch (e) {
    console.error("[i18n] could not remember the guest's language", e);
  }
}
