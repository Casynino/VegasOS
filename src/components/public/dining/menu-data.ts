import type { publicMenu } from "@/server/services/restaurant";
import { MENU_PHOTO_BY_FILE, type MenuPhoto } from "@/lib/menu-photos";
import type { MenuEntry, MenuSection } from "../menu-browser";

/**
 * The live menu shaped for the website — one place for /menu (ordering), /restaurant
 * (dishes from the kitchen) and /bar (the drinks list), so a dish link built on one page
 * opens the same card on the menu (/menu?item=<key>).
 */
export type PublicMenu = Awaited<ReturnType<typeof publicMenu>>;

/** A licensed stock photo (from the menu photo set), not the hotel's own. */
export const isStockPhoto = (src: string) => MENU_PHOTO_BY_FILE.has(src) || src.includes("/illustrative/");

/** "Jameson 750ML" → ["Jameson", "750ML"]; sizes of one drink become one entry. */
const SIZE = /^(.*?)\s+(\d+(?:\.\d+)?\s*(?:ML|CL|L))$/i;
const slug = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Food first, then drinks; in drink sections the sizes of one drink share a card.
 * Entry keys (`<category slug>-<name slug>`) ARE the shareable ?item= links — never change them.
 * `urlOf` is the media library's mediaUrl (passed in so this module stays free of server code).
 */
export function buildMenuSections(cats: PublicMenu, urlOf: (m: { id: string; url: string | null }) => string): MenuSection[] {
  return [...cats.filter((c) => c.type === "FOOD"), ...cats.filter((c) => c.type === "DRINK")].map((c) => {
    const entries: MenuEntry[] = [];
    for (const i of c.items) {
      const m = c.type === "DRINK" ? SIZE.exec(i.name) : null;
      const base = m ? m[1].trim() : i.name;
      const size = { id: i.id, label: m ? m[2].replace(/\s+/g, "").toUpperCase() : null, price: i.price, available: i.isAvailable };
      const same = m ? entries.find((e) => e.name === base && e.sizes[0].label) : undefined;
      if (same) { same.sizes.push(size); continue; }
      const img = i.image?.isActive ? urlOf(i.image) : null;
      entries.push({
        key: `${c.slug}-${slug(base)}`, name: base, description: i.description, subcategory: i.subcategory,
        image: img ? { src: img, alt: i.image?.altText || base, stock: isStockPhoto(img) } : null, sizes: [size],
      });
    }
    return { id: c.id, slug: c.slug, name: c.name, description: c.description, kind: c.type === "DRINK" ? "DRINK" : "FOOD", bar: c.revenueKind === "BAR", entries };
  });
}

export type PhotoCredit = MenuPhoto & { item: string };

/** Stock photos need their credit (CC licences); the hotel's own uploads don't. Every stock photo on the menu. */
export function menuPhotoCredits(cats: PublicMenu): PhotoCredit[] {
  return [...new Map(cats.flatMap((c) => c.items).flatMap((i) => {
    const p = i.image?.isActive && i.image.url ? MENU_PHOTO_BY_FILE.get(i.image.url) : undefined;
    return p ? [[p.sourcePage, { ...p, item: i.name }] as const] : [];
  })).values()];
}

/** Credits for just the photos a page shows. */
export function creditsFor(shown: { name: string; src: string }[]): PhotoCredit[] {
  return [...new Map(shown.flatMap((s) => {
    const p = MENU_PHOTO_BY_FILE.get(s.src);
    return p ? [[p.sourcePage, { ...p, item: s.name }] as const] : [];
  })).values()];
}

export type Dish = { key: string; name: string; description: string | null; price: number; from: boolean; image: { src: string; alt: string }; stock: boolean };

/**
 * Dishes from the kitchen for /restaurant: the manager's picks ("Recommended" in Menu & prices)
 * first, then one dish with a photo from each food section in turn. Only dishes with a photo.
 */
export function kitchenDishes(cats: PublicMenu, sections: MenuSection[], max = 6): Dish[] {
  const featured = new Set(cats.flatMap((c) => c.items).filter((i) => i.isFeatured).map((i) => i.id));
  const food = sections.filter((s) => s.kind === "FOOD").map((s) => s.entries.filter((e) => e.image && e.sizes.some((x) => x.available)));
  const picked: MenuEntry[] = food.flat().filter((e) => e.sizes.some((x) => featured.has(x.id)));
  for (let round = 0; picked.length < max && food.some((list) => list.length > round); round++) {
    for (const list of food) {
      const e = list[round];
      if (e && !picked.includes(e) && picked.length < max) picked.push(e);
    }
  }
  return picked.slice(0, max).map((e) => ({
    key: e.key, name: e.name, description: e.description,
    price: Math.min(...e.sizes.map((x) => x.price)), from: e.sizes.length > 1,
    image: { src: e.image!.src, alt: e.image!.alt }, stock: isStockPhoto(e.image!.src),
  }));
}

export type DrinkShelf = { slug: string; name: string; description: string | null; count: number; from: number; bar: boolean };

/** The drinks list for /bar: every drinks section with how many drinks and the lowest price — bar sections first. */
export function drinkShelves(sections: MenuSection[]): DrinkShelf[] {
  return sections
    .filter((s) => s.kind === "DRINK" && s.entries.length > 0)
    .sort((a, b) => Number(b.bar) - Number(a.bar))
    .map((s) => ({
      slug: s.slug, name: s.name, description: s.description, count: s.entries.length, bar: s.bar,
      from: Math.min(...s.entries.flatMap((e) => e.sizes.map((x) => x.price))),
    }));
}
