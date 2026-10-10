import "server-only";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from "@/i18n/config";
import CONTENT_ZH from "@/i18n/content/zh-CN";
import { forgetContentTranslations } from "@/i18n/server";
import { msg } from "@/i18n/msg";

/**
 * THE HOTEL'S CONTENT IN OTHER LANGUAGES. One record (one MenuItem, one RoomType…) with its English on itself and one
 * translation row per other language (MenuItemTranslation…). Nothing is duplicated: prices, availability, stock and
 * every order stay on the one record.
 *
 * Showing it: the requested language's saved translation → the default Chinese for that English (i18n/content) →
 * the English. Never empty.
 */
export const TRANSLATABLE = {
  menuItem: { model: "MenuItem", fields: ["name", "description"] },
  menuCategory: { model: "MenuCategory", fields: ["name", "description"] },
  roomType: { model: "RoomType", fields: ["name", "shortDescription", "description", "bedType"] },
  amenity: { model: "Amenity", fields: ["name"] },
  hotelService: { model: "HotelService", fields: ["name", "description", "priceNote"] },
  transportService: { model: "TransportService", fields: ["name", "description"] },
  transportServiceOption: { model: "TransportServiceOption", fields: ["name", "description"] },
} as const;
export type TranslatableKind = keyof typeof TRANSLATABLE;
type Row = Record<string, unknown> & { locale?: string };

const SEED: Partial<Record<Locale, Record<string, string>>> = { "zh-CN": CONTENT_ZH };

/** The default translation of a piece of the hotel's English content (null when there is none). */
export function seedText(english: string | null | undefined, locale: Locale): string | null {
  if (!english || locale === DEFAULT_LOCALE) return null;
  return SEED[locale]?.[english.trim()] ?? null;
}

/** For a Prisma include/select: this language's translation row (none for English). */
export const translationsFor = (locale: Locale) => ({ where: { locale } });

/**
 * A record in this language: each translatable field from its translation row, else the default, else the English.
 * The record keeps every other field as it is (ids, prices, flags…).
 */
export function localize<R extends Record<string, unknown>>(record: R & { translations?: Row[] | null }, locale: Locale, fields: readonly string[]): R {
  if (locale === DEFAULT_LOCALE) return record;
  const row = record.translations?.find((x) => x.locale === locale) ?? null;
  const out: Record<string, unknown> = { ...record };
  for (const f of fields) {
    const saved = row?.[f];
    const english = record[f];
    out[f] = typeof saved === "string" && saved.trim() ? saved : typeof english === "string" ? seedText(english, locale) ?? english : english;
  }
  return out as R;
}

const delegate = (tx: Tx | typeof db, kind: TranslatableKind) => {
  const map = {
    menuItem: tx.menuItemTranslation, menuCategory: tx.menuCategoryTranslation, roomType: tx.roomTypeTranslation, amenity: tx.amenityTranslation,
    hotelService: tx.hotelServiceTranslation, transportService: tx.transportServiceTranslation, transportServiceOption: tx.transportServiceOptionTranslation,
  } as const;
  // One shape for all of them: { parentId, locale, …fields }.
  return map[kind] as unknown as {
    findUnique(a: unknown): Promise<Row | null>;
    findMany(a: unknown): Promise<Row[]>;
    upsert(a: unknown): Promise<Row>;
    delete(a: unknown): Promise<Row>;
  };
};

/** The saved translations of one record, every language (for its edit form). */
export async function translationsOf(kind: TranslatableKind, parentId: string): Promise<Record<string, Record<string, string | null>>> {
  const rows = await delegate(db, kind).findMany({ where: { parentId } });
  return Object.fromEntries(rows.map((r) => [String(r.locale), Object.fromEntries(TRANSLATABLE[kind].fields.map((f) => [f, (r[f] as string | null) ?? null]))]));
}

/** One record's translation for its edit form: what staff saved, and the default (shown greyed as a hint). */
export interface TranslationForm { values: Record<string, string>; hints: Record<string, string> }

/** The edit-form translations of many records in one language (one query). Keyed by record id. */
export async function translationForms(kind: TranslatableKind, records: ({ id: string } & Record<string, unknown>)[], locale: Locale = "zh-CN"): Promise<Record<string, TranslationForm>> {
  const fields = TRANSLATABLE[kind].fields as readonly string[];
  const rows = records.length && locale !== DEFAULT_LOCALE ? await delegate(db, kind).findMany({ where: { parentId: { in: records.map((r) => r.id) }, locale } }) : [];
  return Object.fromEntries(records.map((r) => {
    const row = rows.find((x) => x.parentId === r.id);
    const values: Record<string, string> = {};
    const hints: Record<string, string> = {};
    for (const f of fields) {
      const saved = row?.[f];
      if (typeof saved === "string" && saved.trim()) values[f] = saved;
      const seed = typeof r[f] === "string" ? seedText(r[f] as string, locale) : null;
      if (seed) hints[f] = seed;
    }
    return [r.id, { values, hints }];
  }));
}

/**
 * A record's Chinese from its edit form (inputs named zh_<field>, see TranslationFields). Null when the form had no
 * Chinese fields at all, so an older form never wipes a saved translation.
 */
export function translationFromForm(kind: TranslatableKind, formData: FormData): Record<string, string> | null {
  const fields = TRANSLATABLE[kind].fields as readonly string[];
  if (!fields.some((f) => formData.has(`zh_${f}`))) return null;
  return Object.fromEntries(fields.filter((f) => formData.has(`zh_${f}`)).map((f) => [f, String(formData.get(`zh_${f}`) ?? "")]));
}

/**
 * Save one record's text in another language (empty fields fall back to the English). Audited: who, the language,
 * the old and the new text. English itself is edited on the record, not here.
 */
export async function saveTranslation(kind: TranslatableKind, parentId: string, locale: string, values: Record<string, string | null | undefined>, actor: AuditActor & { userId?: string | null }) {
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) throw new AppError("Choose a language other than English.");
  const fields = TRANSLATABLE[kind].fields as readonly string[];
  const clean = Object.fromEntries(fields.map((f) => [f, typeof values[f] === "string" && values[f]!.trim() ? values[f]!.trim().slice(0, f === "description" ? 2000 : 300) : null]));
  return db.$transaction(async (tx) => {
    const d = delegate(tx, kind);
    const before = await d.findUnique({ where: { parentId_locale: { parentId, locale } } });
    const empty = Object.values(clean).every((v) => v === null);
    if (empty) {
      if (before) await d.delete({ where: { parentId_locale: { parentId, locale } } });
    } else {
      await d.upsert({
        where: { parentId_locale: { parentId, locale } },
        create: { parentId, locale, ...clean, updatedById: actor.userId ?? null },
        update: { ...clean, updatedById: actor.userId ?? null },
      });
    }
    await audit(tx, actor, {
      action: "translation.saved", entityType: TRANSLATABLE[kind].model, entityId: parentId,
      before: before ? { locale, ...Object.fromEntries(fields.map((f) => [f, before[f] ?? null])) } : { locale },
      after: { locale, ...clean },
    });
    return { removed: empty };
  }).then((r) => {
    forgetContentTranslations();
    return r;
  });
}

/**
 * A dish's name in every language right now — kept on each order line when it is ordered (nameI18n), so the
 * kitchen reads it in English and the guest in Chinese, and an old order never changes.
 */
export async function menuNamesNow(tx: Tx | typeof db, items: { id: string; name: string }[]): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (!items.length) return out;
  const rows = await tx.menuItemTranslation.findMany({ where: { parentId: { in: items.map((i) => i.id) } }, select: { parentId: true, locale: true, name: true } });
  for (const it of items) {
    const names: Record<string, string> = {};
    for (const l of LOCALES) {
      if (l === DEFAULT_LOCALE) continue;
      const saved = rows.find((r) => r.parentId === it.id && r.locale === l)?.name?.trim();
      const v = saved || seedText(it.name, l);
      if (v) names[l] = v;
    }
    out.set(it.id, names);
  }
  return out;
}

/** How much of the hotel's content each language covers (Settings → Languages). */
export async function contentCoverage() {
  const [menu, cats, rooms, amen, svc, trs, opts, tMenu, tCats, tRooms, tAmen, tSvc, tTrs, tOpts] = await Promise.all([
    db.menuItem.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }] }),
    db.menuCategory.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: { sortOrder: "asc" } }),
    db.roomType.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: { sortOrder: "asc" } }),
    db.amenity.findMany({ select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.hotelService.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: { sortOrder: "asc" } }),
    db.transportService.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: { sortOrder: "asc" } }),
    db.transportServiceOption.findMany({ where: { isActive: true }, select: { id: true, name: true, description: true }, orderBy: [{ service: { sortOrder: "asc" } }, { sortOrder: "asc" }] }),
    db.menuItemTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.menuCategoryTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.roomTypeTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.amenityTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.hotelServiceTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.transportServiceTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
    db.transportServiceOptionTranslation.findMany({ select: { parentId: true, locale: true, name: true } }),
  ]);
  const count = (label: string, kind: TranslatableKind, all: { id: string; name: string; description?: string | null }[], saved: { parentId: string; locale: string; name: string | null }[]) => {
    const per = Object.fromEntries(LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => {
      const missing = all.filter((x) => !saved.some((s) => s.parentId === x.id && s.locale === l && s.name?.trim()) && !seedText(x.name, l));
      return [l, { translated: all.length - missing.length, missing: missing.map((m) => ({ id: m.id, name: m.name, description: m.description ?? null })) }];
    }));
    return { kind, label, total: all.length, per };
  };
  return [
    count(msg("Menu items"), "menuItem", menu, tMenu), count(msg("Menu categories"), "menuCategory", cats, tCats), count(msg("Room types"), "roomType", rooms, tRooms),
    count(msg("Room amenities"), "amenity", amen, tAmen), count(msg("Hotel services"), "hotelService", svc, tSvc), count(msg("Transport services"), "transportService", trs, tTrs),
    count(msg("Transport options"), "transportServiceOption", opts, tOpts),
  ];
}
