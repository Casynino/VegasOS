/**
 * What the kitchen and bar ask the manager for — the ingredients behind the menu's dishes and
 * the supplies they use every day, each with a picture so it is clear at a glance. Drinks come
 * from the live menu with their own photos (see the stock page). Anything missing can still be
 * typed ("Something else"). Names and units are English (what is kept on a request) — shown with t(…).
 */
import { msg } from "@/i18n/msg";

export type StockItem = { name: string; unit: string; emoji: string; image?: string | null };
export type StockGroup = { key: string; name: string; emoji: string; items: StockItem[] };

const g = (key: string, name: string, emoji: string, items: [string, string, string][]): StockGroup =>
  ({ key, name, emoji, items: items.map(([n, unit, e]) => ({ name: n, unit, emoji: e })) });

export const STOCK_CATALOG: StockGroup[] = [
  g("meat", msg("Meat & fish"), "🥩", [
    [msg("Beef"), "kg", "🥩"], [msg("Beef steak"), "kg", "🥩"], [msg("Beef mince"), "kg", "🥩"], [msg("Goat meat"), "kg", "🍖"], [msg("Whole chicken"), "pcs", "🐔"],
    [msg("Chicken wings"), "kg", "🍗"], [msg("Chicken breast"), "kg", "🍗"], [msg("Sausages"), "packs", "🌭"], [msg("Bacon"), "packs", "🥓"],
    [msg("Whole fish (tilapia)"), "pcs", "🐟"], [msg("Fish fillet"), "kg", "🐟"], [msg("Dagaa"), "kg", "🐠"],
  ]),
  g("veg", msg("Vegetables & fruit"), "🥬", [
    [msg("Onions"), "kg", "🧅"], [msg("Tomatoes"), "kg", "🍅"], [msg("Potatoes"), "kg", "🥔"], [msg("Carrots"), "kg", "🥕"], [msg("Green pepper"), "kg", "🫑"],
    [msg("Cabbage"), "pcs", "🥬"], [msg("Sukuma wiki"), "bunches", "🥬"], [msg("Spinach"), "bunches", "🥬"], [msg("Lettuce"), "pcs", "🥗"], [msg("Cucumber"), "kg", "🥒"],
    [msg("Mushrooms"), "kg", "🍄"], [msg("Garlic"), "kg", "🧄"], [msg("Ginger"), "kg", "🫚"], [msg("Pili-pili (chilli)"), "kg", "🌶️"], [msg("Coriander (dhania)"), "bunches", "🌿"],
    [msg("Green bananas (ndizi)"), "bunches", "🍌"], [msg("Lemons"), "kg", "🍋"], [msg("Limes"), "kg", "🍋"], [msg("Mangoes"), "kg", "🥭"], [msg("Passion fruit"), "kg", "🍈"],
    [msg("Pineapples"), "pcs", "🍍"], [msg("Watermelons"), "pcs", "🍉"], [msg("Bananas"), "bunches", "🍌"], [msg("Avocados"), "pcs", "🥑"], [msg("Mint leaves"), "bunches", "🌿"],
  ]),
  g("dry", msg("Rice, flour & dry food"), "🍚", [
    [msg("Rice"), "kg", "🍚"], [msg("Basmati rice"), "kg", "🍚"], [msg("Maize flour (sembe)"), "kg", "🌽"], [msg("Wheat flour"), "kg", "🌾"], [msg("Spaghetti"), "packs", "🍝"],
    [msg("Beans"), "kg", "🫘"], [msg("Sugar"), "kg", "🍬"], [msg("Salt"), "kg", "🧂"], [msg("Bread (toast loaf)"), "pcs", "🍞"], [msg("Burger buns"), "packs", "🍔"],
    [msg("Spring roll pastry"), "packs", "🥟"], [msg("Coconut milk"), "tins", "🥥"], [msg("Tomato paste"), "tins", "🥫"], [msg("Baked beans"), "tins", "🥫"],
  ]),
  g("dairy", msg("Dairy & eggs"), "🥚", [
    [msg("Eggs"), "trays", "🥚"], [msg("Milk"), "litres", "🥛"], [msg("Butter"), "kg", "🧈"], [msg("Cheese"), "kg", "🧀"], [msg("Cooking cream"), "litres", "🥛"], [msg("Yoghurt"), "litres", "🥛"],
  ]),
  g("spice", msg("Oil, spices & sauces"), "🫒", [
    [msg("Cooking oil"), "litres", "🫒"], [msg("Pilau masala"), "packs", "🧂"], [msg("Curry powder"), "packs", "🍛"], [msg("Biryani spice"), "packs", "🍛"], [msg("Black pepper"), "packs", "🧂"],
    [msg("Mixed spices"), "packs", "🧂"], [msg("Stock cubes"), "packs", "🍲"], [msg("BBQ sauce"), "bottles", "🥫"], [msg("Tomato sauce (ketchup)"), "bottles", "🍅"],
    [msg("Chilli sauce"), "bottles", "🌶️"], [msg("Mayonnaise"), "jars", "🫙"], [msg("Vinegar"), "bottles", "🍶"], [msg("Soy sauce"), "bottles", "🍶"],
  ]),
  g("hot", msg("Tea & coffee"), "☕", [
    [msg("Tea leaves"), "packs", "🍃"], [msg("Tea bags"), "boxes", "🍵"], [msg("Coffee"), "packs", "☕"], [msg("Drinking chocolate"), "packs", "🍫"],
  ]),
  g("supplies", msg("Supplies"), "📦", [
    [msg("Cooking gas"), "cylinders", "🔥"], [msg("Charcoal"), "bags", "🪵"], [msg("Ice"), "bags", "🧊"], [msg("Takeaway boxes"), "packs", "🥡"], [msg("Takeaway cups"), "packs", "🥤"],
    [msg("Straws"), "packs", "🥤"], [msg("Serviettes"), "packs", "🧻"], [msg("Kitchen foil"), "rolls", "🧻"], [msg("Cling film"), "rolls", "🧻"], [msg("Dish soap"), "litres", "🧴"],
    [msg("Sponges"), "packs", "🧽"], [msg("Rubbish bags"), "packs", "🗑️"], [msg("Gloves"), "boxes", "🧤"],
  ]),
];

/** A drink's usual unit when the bar orders it: beer and soda by the crate, water by the pack, the rest by the bottle. */
export function drinkUnit(section: string, name: string) {
  if (/water/i.test(name)) return msg("packs");
  if (/beer|lager|soda|soft/i.test(`${section} ${name}`)) return msg("crates");
  return msg("bottles");
}
/** A picture for a drink without a photo. */
export function drinkEmoji(section: string, name: string) {
  const s = `${section} ${name}`;
  return /water/i.test(name) ? "💧" : /soda|soft/i.test(s) ? "🥤" : /beer|lager/i.test(s) ? "🍺" : /wine|champ/i.test(s) ? "🍷" : /whisk/i.test(s) ? "🥃" : "🍸";
}

export const STOCK_UNITS = ["kg", "g", msg("pcs"), msg("litres"), msg("bottles"), msg("crates"), msg("packs"), msg("trays"), msg("bags"), msg("boxes"), msg("bunches"), msg("tins"), msg("jars"), msg("rolls"), msg("cylinders")];
