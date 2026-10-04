import "server-only";
import { cache } from "react";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { DEFAULT_CONTENT, type GalleryCategory, type GalleryImage, type SiteContent } from "@/components/public/content";
import { mediaUrl } from "./media";
import type { MediaCategory } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";

/**
 * Website CMS. Public copy lives as verified defaults in content.ts; managers
 * override individual fields (stored in `site_content`, one row per field
 * path). Services and the gallery come straight from their DB tables.
 */

export type CmsFieldType = "text" | "textarea" | "list" | "image";
export interface CmsField { path: string; label: string; type: CmsFieldType; help?: string }
export interface CmsSection { key: string; title: string; fields: CmsField[] }

export const CMS_SECTIONS: CmsSection[] = [
  { key: "hero", title: "Home — hero", fields: [
    { path: "home.hero.image", label: "Hero photo", type: "image" },
    { path: "home.hero.title", label: "Headline", type: "text" },
    { path: "home.hero.titleAccent", label: "Headline — gold second line", type: "text" },
    { path: "home.hero.intro", label: "One-sentence intro", type: "textarea", help: "Keep it to one sentence. Placeholders: {hotelName} {address}" },
    { path: "home.hero.primaryCta.label", label: "Primary button", type: "text" },
    { path: "home.hero.secondaryCta.label", label: "Secondary button", type: "text" },
  ] },
  { key: "intro", title: "Home — hotel introduction", fields: [
    { path: "home.intro.title", label: "Title", type: "text" },
    { path: "home.intro.titleAccent", label: "Title accent (gold)", type: "text" },
    { path: "home.intro.paragraphs", label: "Paragraphs (one per line)", type: "list" },
    { path: "home.intro.mainImage", label: "Main photo", type: "image" },
    { path: "home.intro.insetImage", label: "Inset photo", type: "image" },
  ] },
  { key: "experience", title: "Home — why guests choose us", fields: [
    { path: "home.experience.title", label: "Title", type: "text" },
    { path: "home.experience.intro", label: "Intro", type: "textarea" },
    { path: "home.experience.image", label: "Photo", type: "image" },
  ] },
  { key: "restaurant", title: "Restaurant & breakfast", fields: [
    { path: "home.restaurant.body", label: "Home teaser", type: "textarea" },
    { path: "pages.restaurant.title", label: "Page title", type: "text" },
    { path: "pages.restaurant.intro", label: "Page intro", type: "textarea" },
    { path: "pages.restaurant.cuisinesBody", label: "About the menu", type: "textarea" },
    { path: "pages.restaurant.cuisines", label: "Cuisines (one per line)", type: "list" },
    { path: "pages.restaurant.meals", label: "Meals served (one per line)", type: "list" },
    { path: "pages.restaurant.dietary", label: "Dietary options (one per line)", type: "list" },
    { path: "pages.restaurant.breakfastNote", label: "Breakfast note", type: "textarea" },
  ] },
  { key: "bar", title: "Bar", fields: [
    { path: "home.bar.body", label: "Home teaser", type: "textarea" },
    { path: "pages.bar.title", label: "Page title", type: "text" },
    { path: "pages.bar.intro", label: "Page intro", type: "textarea" },
  ] },
  { key: "meeting", title: "Meeting room", fields: [
    { path: "home.meeting.body", label: "Home teaser", type: "textarea" },
  ] },
  { key: "arrival", title: "Arrival & airport transfer", fields: [
    { path: "home.arrival.title", label: "Title", type: "text" },
    { path: "home.arrival.body", label: "Text", type: "textarea", help: "Placeholders: {hotelName} {airportKm}" },
    { path: "facts.airportKm", label: "Distance to airport (km)", type: "text" },
  ] },
  { key: "location", title: "Location", fields: [
    { path: "home.location.title", label: "Title", type: "text" },
    { path: "home.location.image", label: "Photo", type: "image" },
    { path: "facts.locationLine", label: "Location line", type: "text" },
  ] },
  { key: "hotel", title: "The Hotel page", fields: [
    { path: "pages.hotel.title", label: "Title", type: "text" },
    { path: "pages.hotel.intro", label: "Intro", type: "textarea" },
    { path: "pages.hotel.about", label: "About paragraphs (one per line)", type: "list" },
    { path: "pages.hotel.image", label: "Header photo", type: "image" },
  ] },
  { key: "contact", title: "Contact & footer", fields: [
    { path: "pages.contact.intro", label: "Contact page intro", type: "textarea" },
    { path: "pages.footer.blurb", label: "Footer text", type: "textarea" },
  ] },
  { key: "seo", title: "Search engines", fields: [
    { path: "seo.homeTitle", label: "Home page title", type: "text" },
    { path: "seo.homeDescription", label: "Home page description", type: "textarea" },
    { path: "seo.ogImage", label: "Share image", type: "image" },
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

/** Site content = verified defaults + manager overrides + live services & gallery. Cached per request. */
export const getSiteContent = cache(async (): Promise<SiteContent> => {
  const content = structuredClone(DEFAULT_CONTENT) as SiteContent;
  const [overrides, services, media] = await Promise.all([
    db.siteContent.findMany(),
    db.hotelService.findMany({ where: { isActive: true, isPublic: true }, orderBy: { sortOrder: "asc" } }),
    db.mediaAsset.findMany({ where: { isActive: true, isIllustrative: false }, orderBy: [{ category: "asc" }, { sortOrder: "asc" }] }),
  ]);
  for (const o of overrides) if (ALLOWED.has(o.key)) setPath(content as unknown as Record<string, unknown>, o.key, o.value);
  if (typeof content.facts.airportKm !== "number") content.facts.airportKm = Number(content.facts.airportKm) || DEFAULT_CONTENT.facts.airportKm;
  if (services.length) {
    content.services = services.map((s) => ({ key: s.code, name: s.name, icon: s.icon ?? "Check", description: s.description ?? "" }));
  }
  const gallery: GalleryImage[] = media
    .filter((m) => GALLERY_MAP[m.category] && m.width && m.height)
    .map((m) => ({ src: mediaUrl(m), width: m.width!, height: m.height!, alt: m.altText, category: GALLERY_MAP[m.category]! }));
  if (gallery.length) content.gallery = gallery as SiteContent["gallery"];
  return content;
});

/** Current value (override or default) of every editable field, for the CMS editor. */
export async function getEditableContent() {
  const content = await getSiteContent();
  const overridden = new Set((await db.siteContent.findMany({ select: { key: true } })).map((r) => r.key));
  return CMS_SECTIONS.map((s) => ({
    ...s,
    fields: s.fields.map((f) => ({ ...f, value: getPath(content, f.path), isCustom: overridden.has(f.path), defaultValue: getPath(DEFAULT_CONTENT, f.path) })),
  }));
}

export async function saveContentField(path: string, value: unknown, actor: AuditActor & { userId: string }) {
  const field = ALLOWED.get(path);
  if (!field) throw new AppError("This field cannot be edited.");
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
  const before = await db.siteContent.findUnique({ where: { key: path } });
  await db.siteContent.upsert({
    where: { key: path },
    update: { value: clean as Prisma.InputJsonValue, updatedById: actor.userId },
    create: { key: path, value: clean as Prisma.InputJsonValue, updatedById: actor.userId },
  });
  await audit(db, actor, { action: "website.content_updated", entityType: "SiteContent", entityId: path, before: before?.value ?? getPath(DEFAULT_CONTENT, path), after: clean });
}

export async function resetContentField(path: string, actor: AuditActor) {
  if (!ALLOWED.has(path)) throw new AppError("This field cannot be edited.");
  await db.siteContent.deleteMany({ where: { key: path } });
  await audit(db, actor, { action: "website.content_reset", entityType: "SiteContent", entityId: path });
}
