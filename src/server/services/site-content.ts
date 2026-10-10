import "server-only";
import { cache } from "react";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { DEFAULT_CONTENT, type GalleryCategory, type GalleryImage, type SiteContent } from "@/components/public/content";
import { CONTENT_ZH, altZh, overlay } from "@/components/public/content.zh-CN";
import { mediaUrl } from "./media";
import type { MediaCategory } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { localize, translationsFor } from "./translations";

/**
 * Website CMS. Public copy lives as verified defaults in content.ts (English) and content.zh-CN.ts (Chinese);
 * managers override individual fields (stored in `site_content`, one row per field path — "zh-CN:<path>" for the
 * Chinese). Services and the gallery come straight from their DB tables.
 *
 * A Chinese visitor sees, per field: the Chinese saved by staff → the Chinese default, but only while the English
 * field is unchanged → the English (an English edit is never hidden behind an old translation). Photos are shared by
 * both languages; only their alt text is translated.
 */

export type CmsFieldType = "text" | "textarea" | "list" | "image";
/** `shared`: one value for every language (numbers, photos). */
export interface CmsField { path: string; label: string; type: CmsFieldType; help?: string; shared?: boolean }
export interface CmsSection { key: string; title: string; fields: CmsField[] }


export const CMS_SECTIONS: CmsSection[] = [
  { key: "hero", title: msg("Home — hero"), fields: [
    { path: "home.hero.image", label: msg("Hero photo"), type: "image" },
    { path: "home.hero.title", label: msg("Headline"), type: "text" },
    { path: "home.hero.titleAccent", label: msg("Headline — gold second line"), type: "text" },
    { path: "home.hero.intro", label: msg("One-sentence intro"), type: "textarea", help: msg("Keep it to one sentence. Placeholders: {hotelName} {address}") },
    { path: "home.hero.primaryCta.label", label: msg("Primary button"), type: "text" },
    { path: "home.hero.secondaryCta.label", label: msg("Secondary button"), type: "text" },
  ] },
  { key: "intro", title: msg("Home — hotel introduction"), fields: [
    { path: "home.intro.title", label: msg("Title"), type: "text" },
    { path: "home.intro.titleAccent", label: msg("Title accent (gold)"), type: "text" },
    { path: "home.intro.paragraphs", label: msg("Paragraphs (one per line)"), type: "list" },
    { path: "home.intro.mainImage", label: msg("Main photo"), type: "image" },
    { path: "home.intro.insetImage", label: msg("Inset photo"), type: "image" },
  ] },
  { key: "experience", title: msg("Home — why guests choose us"), fields: [
    { path: "home.experience.title", label: msg("Title"), type: "text" },
    { path: "home.experience.intro", label: msg("Intro"), type: "textarea" },
    { path: "home.experience.image", label: msg("Photo"), type: "image" },
  ] },
  { key: "restaurant", title: msg("Restaurant & breakfast"), fields: [
    { path: "home.restaurant.body", label: msg("Home teaser"), type: "textarea" },
    { path: "pages.restaurant.title", label: msg("Page title"), type: "text" },
    { path: "pages.restaurant.intro", label: msg("Page intro"), type: "textarea" },
    { path: "pages.restaurant.cuisinesBody", label: msg("About the menu"), type: "textarea" },
    { path: "pages.restaurant.cuisines", label: msg("Cuisines (one per line)"), type: "list" },
    { path: "pages.restaurant.meals", label: msg("Meals served (one per line)"), type: "list" },
    { path: "pages.restaurant.dietary", label: msg("Dietary options (one per line)"), type: "list" },
    { path: "pages.restaurant.breakfastNote", label: msg("Breakfast note"), type: "textarea" },
  ] },
  { key: "bar", title: msg("Bar"), fields: [
    { path: "home.bar.body", label: msg("Home teaser"), type: "textarea" },
    { path: "pages.bar.title", label: msg("Page title"), type: "text" },
    { path: "pages.bar.intro", label: msg("Page intro"), type: "textarea" },
  ] },
  { key: "meeting", title: msg("Meeting room"), fields: [
    { path: "home.meeting.body", label: msg("Home teaser"), type: "textarea" },
  ] },
  { key: "arrival", title: msg("Arrival & airport transfer"), fields: [
    { path: "home.arrival.title", label: msg("Title"), type: "text" },
    { path: "home.arrival.body", label: msg("Text"), type: "textarea", help: msg("Placeholders: {hotelName} {airportKm}") },
    { path: "facts.airportKm", label: msg("Distance to airport (km)"), type: "text", shared: true },
  ] },
  { key: "location", title: msg("Location"), fields: [
    { path: "home.location.title", label: msg("Title"), type: "text" },
    { path: "home.location.image", label: msg("Photo"), type: "image" },
    { path: "facts.locationLine", label: msg("Location line"), type: "text" },
  ] },
  { key: "hotel", title: msg("The Hotel page"), fields: [
    { path: "pages.hotel.title", label: msg("Title"), type: "text" },
    { path: "pages.hotel.intro", label: msg("Intro"), type: "textarea" },
    { path: "pages.hotel.about", label: msg("About paragraphs (one per line)"), type: "list" },
    { path: "pages.hotel.image", label: msg("Header photo"), type: "image" },
  ] },
  { key: "contact", title: msg("Contact & footer"), fields: [
    { path: "pages.contact.intro", label: msg("Contact page intro"), type: "textarea" },
    { path: "pages.footer.blurb", label: msg("Footer text"), type: "textarea" },
  ] },
  { key: "seo", title: msg("Search engines"), fields: [
    { path: "seo.homeTitle", label: msg("Home page title"), type: "text" },
    { path: "seo.homeDescription", label: msg("Home page description"), type: "textarea" },
    { path: "seo.ogImage", label: msg("Share image"), type: "image" },
  ] },
];
const ALLOWED = new Map(CMS_SECTIONS.flatMap((s) => s.fields.map((f) => [f.path, f] as const)));

export function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== "object") o[k] = {};
    o = o[k] as Record<string, unknown>;
  }
  o[keys.at(-1)!] = value;
}


const GALLERY_MAP: Partial<Record<MediaCategory, GalleryCategory>> = {
  ROOMS: "rooms", BATHROOMS: "bath", RECEPTION: "lobby", EXTERIOR: "exterior", FACILITIES: "amenity", EXPERIENCE: "amenity",
};

/** One value for every language: photos and numbers. */
const isShared = (f: CmsField) => f.type === "image" || !!f.shared;
/** The row that holds a field in a language: English under its path, other languages under "<locale>:<path>". */
const keyFor = (path: string, locale: Locale) => (locale === DEFAULT_LOCALE ? path : `${locale}:${path}`);

/** Every photo's alt text in Chinese where it is known (defaults, staff's photo choices, the gallery). */
function translateAlts(node: unknown) {
  if (Array.isArray(node)) {
    node.forEach(translateAlts);
  } else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.alt === "string") o.alt = altZh(o.alt);
    for (const v of Object.values(o)) if (v && typeof v === "object") translateAlts(v);
  }
}

/** The site's built-in copy in a language, before any staff edits. */
export function defaultContent(locale: Locale): SiteContent {
  const en = structuredClone(DEFAULT_CONTENT) as SiteContent;
  return locale === "zh-CN" ? (overlay(en, CONTENT_ZH) as SiteContent) : en;
}

/** Site content in one language = its defaults + manager overrides + live services & gallery. Cached per request. */
const contentFor = cache(async (locale: Locale): Promise<SiteContent> => {
  const content = defaultContent(locale);
  const [overrides, services, media] = await Promise.all([
    db.siteContent.findMany(),
    db.hotelService.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" }, include: { translations: translationsFor(locale) } }),
    db.mediaAsset.findMany({ where: { isActive: true, isIllustrative: false }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
  ]);
  // English edits first — they replace a default translation that no longer matches — then this language's own.
  for (const o of overrides) if (ALLOWED.has(o.key)) setPath(content as unknown as Record<string, unknown>, o.key, o.value);
  if (locale !== DEFAULT_LOCALE) {
    const prefix = `${locale}:`;
    for (const o of overrides) {
      const path = o.key.startsWith(prefix) ? o.key.slice(prefix.length) : null;
      const field = path ? ALLOWED.get(path) : undefined;
      if (path && field && !isShared(field)) setPath(content as unknown as Record<string, unknown>, path, o.value);
    }
  }
  if (typeof content.facts.airportKm !== "number") content.facts.airportKm = Number(content.facts.airportKm) || DEFAULT_CONTENT.facts.airportKm;
  if (services.length) {
    content.services = services.map((s) => {
      const l = localize(s, locale, ["name", "description"]);
      return { key: s.code, name: l.name, icon: s.icon ?? "Check", description: l.description ?? "" };
    });
  }
  const gallery: GalleryImage[] = media
    .filter((m) => GALLERY_MAP[m.category] && m.width && m.height)
    .map((m) => ({ src: mediaUrl(m), width: m.width!, height: m.height!, alt: m.altText, category: GALLERY_MAP[m.category]! }));
  if (gallery.length) content.gallery = gallery as SiteContent["gallery"];
  if (locale === "zh-CN") translateAlts(content);
  return content;
});

/** The website's content in the visitor's language (or the one asked for). Cached per request per language. */
export async function getSiteContent(locale?: Locale): Promise<SiteContent> {
  return contentFor(locale ?? (await getLocale()));
}

/**
 * Every editable field for the CMS editor: its English (override or default) and, for text, its Chinese — what staff
 * saved, and what a Chinese visitor sees without it (the Chinese default, or the English when the English was edited).
 */
export async function getEditableContent() {
  const [content, rows] = await Promise.all([
    contentFor(DEFAULT_LOCALE),
    db.siteContent.findMany({ select: { key: true, value: true, updatedAt: true } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const zhDefaults = defaultContent("zh-CN");
  return CMS_SECTIONS.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      const en = byKey.get(f.path);
      const zh = isShared(f) ? undefined : byKey.get(keyFor(f.path, "zh-CN"));
      return {
        ...f,
        shared: isShared(f),
        value: getPath(content, f.path),
        isCustom: !!en,
        defaultValue: getPath(DEFAULT_CONTENT, f.path),
        zh: isShared(f) ? null : {
          value: zh ? (zh.value as unknown) : null,
          /** Shown to Chinese visitors while nothing is saved. */
          fallback: en ? (en.value as unknown) : getPath(zhDefaults, f.path),
          fallbackIsEnglish: !!en,
          /** The English was changed after this Chinese was saved. */
          stale: !!(zh && en && en.updatedAt > zh.updatedAt),
        },
      };
    }),
  }));
}

function languageOf(locale: string | null | undefined): Locale {
  const l = locale ?? DEFAULT_LOCALE;
  if (!isLocale(l)) throw new AppError("Choose a language.");
  return l;
}

export async function saveContentField(path: string, value: unknown, actor: AuditActor & { userId: string }, locale: string = DEFAULT_LOCALE) {
  const field = ALLOWED.get(path);
  if (!field) throw new AppError("This field cannot be edited.");
  const lang = languageOf(locale);
  if (lang !== DEFAULT_LOCALE && isShared(field)) throw new AppError("Photos and numbers are the same in every language — change them in English.");
  let clean: unknown = value;
  if (field.type === "text" || field.type === "textarea") {
    clean = String(value ?? "").trim();
    if (!clean) throw new AppError("This field cannot be empty — use “Reset to default” instead.");
    if ((clean as string).length > 2000) throw new AppError("Too long (max 2000 characters).");
    if (path === "facts.airportKm") {
      const n = Number(clean);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw new AppError("Enter a distance in km.");
      clean = n;
    }
  } else if (field.type === "list") {
    clean = String(value ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 20);
    if ((clean as string[]).length === 0) throw new AppError("Add at least one line.");
  } else if (field.type === "image") {
    const media = await db.mediaAsset.findUnique({ where: { id: String(value) } });
    if (!media || !media.isActive) throw new AppError("Choose an active photo from the media library.");
    if (media.isIllustrative && !path.startsWith("home.restaurant") && !path.startsWith("pages.restaurant") && !path.startsWith("home.bar") && !path.startsWith("pages.bar")) {
      throw new AppError("Illustrative (non-hotel) images can only be used on the restaurant and bar sections.");
    }
    clean = { src: mediaUrl(media), alt: media.altText };
  }
  const key = keyFor(path, lang);
  const before = await db.siteContent.findUnique({ where: { key } });
  await db.siteContent.upsert({
    where: { key },
    update: { value: clean as Prisma.InputJsonValue, updatedById: actor.userId },
    create: { key, value: clean as Prisma.InputJsonValue, updatedById: actor.userId },
  });
  if (lang === DEFAULT_LOCALE) {
    await audit(db, actor, { action: "website.content_updated", entityType: "SiteContent", entityId: path, before: before?.value ?? getPath(DEFAULT_CONTENT, path), after: clean });
  } else {
    await audit(db, actor, {
      action: "website.content_updated", entityType: "SiteContent", entityId: key,
      before: { language: lang, value: before?.value ?? getPath(defaultContent(lang), path) ?? null },
      after: { language: lang, value: clean },
    });
  }
}

export async function resetContentField(path: string, actor: AuditActor, locale: string = DEFAULT_LOCALE) {
  const field = ALLOWED.get(path);
  if (!field) throw new AppError("This field cannot be edited.");
  const lang = languageOf(locale);
  if (lang !== DEFAULT_LOCALE && isShared(field)) throw new AppError("Photos and numbers are the same in every language — change them in English.");
  const key = keyFor(path, lang);
  await db.siteContent.deleteMany({ where: { key } });
  await audit(db, actor, { action: "website.content_reset", entityType: "SiteContent", entityId: key, ...(lang === DEFAULT_LOCALE ? {} : { after: { language: lang } }) });
}
