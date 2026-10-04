/**
 * What the kitchen and bar ask the manager for — the ingredients behind the menu's dishes and
 * the supplies they use every day, each with a picture so it is clear at a glance. Drinks come
 * from the live menu with their own photos (see the stock page). Anything missing can still be
 * typed ("Something else").
 */
export type StockItem = { name: string; unit: string; emoji: string; image?: string | null };
export type StockGroup = { key: string; name: string; emoji: string; items: StockItem[] };

const g = (key: string, name: string, emoji: string, items: [string, string, string][]): StockGroup =>
  ({ key, name, emoji, items: items.map(([n, unit, e]) => ({ name: n, unit, emoji: e })) });

export const STOCK_CATALOG: StockGroup[] = [
  g("meat", "Meat & fish", "🥩", [
    ["Beef", "kg", "🥩"], ["Beef steak", "kg", "🥩"], ["Beef mince", "kg", "🥩"], ["Goat meat", "kg", "🍖"], ["Whole chicken", "pcs", "🐔"],
    ["Chicken wings", "kg", "🍗"], ["Chicken breast", "kg", "🍗"], ["Sausages", "packs", "🌭"], ["Bacon", "packs", "🥓"],
    ["Whole fish (tilapia)", "pcs", "🐟"], ["Fish fillet", "kg", "🐟"], ["Dagaa", "kg", "🐠"],
  ]),
  g("veg", "Vegetables & fruit", "🥬", [
    ["Onions", "kg", "🧅"], ["Tomatoes", "kg", "🍅"], ["Potatoes", "kg", "🥔"], ["Carrots", "kg", "🥕"], ["Green pepper", "kg", "🫑"],
    ["Cabbage", "pcs", "🥬"], ["Sukuma wiki", "bunches", "🥬"], ["Spinach", "bunches", "🥬"], ["Lettuce", "pcs", "🥗"], ["Cucumber", "kg", "🥒"],
    ["Mushrooms", "kg", "🍄"], ["Garlic", "kg", "🧄"], ["Ginger", "kg", "🫚"], ["Pili-pili (chilli)", "kg", "🌶️"], ["Coriander (dhania)", "bunches", "🌿"],
    ["Green bananas (ndizi)", "bunches", "🍌"], ["Lemons", "kg", "🍋"], ["Limes", "kg", "🍋"], ["Mangoes", "kg", "🥭"], ["Passion fruit", "kg", "🍈"],
    ["Pineapples", "pcs", "🍍"], ["Watermelons", "pcs", "🍉"], ["Bananas", "bunches", "🍌"], ["Avocados", "pcs", "🥑"], ["Mint leaves", "bunches", "🌿"],
  ]),
  g("dry", "Rice, flour & dry food", "🍚", [
    ["Rice", "kg", "🍚"], ["Basmati rice", "kg", "🍚"], ["Maize flour (sembe)", "kg", "🌽"], ["Wheat flour", "kg", "🌾"], ["Spaghetti", "packs", "🍝"],
    ["Beans", "kg", "🫘"], ["Sugar", "kg", "🍬"], ["Salt", "kg", "🧂"], ["Bread (toast loaf)", "pcs", "🍞"], ["Burger buns", "packs", "🍔"],
    ["Spring roll pastry", "packs", "🥟"], ["Coconut milk", "tins", "🥥"], ["Tomato paste", "tins", "🥫"], ["Baked beans", "tins", "🥫"],
  ]),
  g("dairy", "Dairy & eggs", "🥚", [
    ["Eggs", "trays", "🥚"], ["Milk", "litres", "🥛"], ["Butter", "kg", "🧈"], ["Cheese", "kg", "🧀"], ["Cooking cream", "litres", "🥛"], ["Yoghurt", "litres", "🥛"],
  ]),
  g("spice", "Oil, spices & sauces", "🫒", [
    ["Cooking oil", "litres", "🫒"], ["Pilau masala", "packs", "🧂"], ["Curry powder", "packs", "🍛"], ["Biryani spice", "packs", "🍛"], ["Black pepper", "packs", "🧂"],
    ["Mixed spices", "packs", "🧂"], ["Stock cubes", "packs", "🍲"], ["BBQ sauce", "bottles", "🥫"], ["Tomato sauce (ketchup)", "bottles", "🍅"],
    ["Chilli sauce", "bottles", "🌶️"], ["Mayonnaise", "jars", "🫙"], ["Vinegar", "bottles", "🍶"], ["Soy sauce", "bottles", "🍶"],
  ]),
  g("hot", "Tea & coffee", "☕", [
    ["Tea leaves", "packs", "🍃"], ["Tea bags", "boxes", "🍵"], ["Coffee", "packs", "☕"], ["Drinking chocolate", "packs", "🍫"],
  ]),
  g("supplies", "Supplies", "📦", [
    ["Cooking gas", "cylinders", "🔥"], ["Charcoal", "bags", "🪵"], ["Ice", "bags", "🧊"], ["Takeaway boxes", "packs", "🥡"], ["Takeaway cups", "packs", "🥤"],
    ["Straws", "packs", "🥤"], ["Serviettes", "packs", "🧻"], ["Kitchen foil", "rolls", "🧻"], ["Cling film", "rolls", "🧻"], ["Dish soap", "litres", "🧴"],
    ["Sponges", "packs", "🧽"], ["Rubbish bags", "packs", "🗑️"], ["Gloves", "boxes", "🧤"],
  ]),
];

/** A drink's usual unit when the bar orders it: beer and soda by the crate, water by the pack, the rest by the bottle. */
export function drinkUnit(section: string, name: string) {
  if (/water/i.test(name)) return "packs";
  if (/beer|lager|soda|soft/i.test(`${section} ${name}`)) return "crates";
  return "bottles";
}
/** A picture for a drink without a photo. */
export function drinkEmoji(section: string, name: string) {
  const s = `${section} ${name}`;
  return /water/i.test(name) ? "💧" : /soda|soft/i.test(s) ? "🥤" : /beer|lager/i.test(s) ? "🍺" : /wine|champ/i.test(s) ? "🍷" : /whisk/i.test(s) ? "🥃" : "🍸";
}

export const STOCK_UNITS = ["kg", "g", "pcs", "litres", "bottles", "crates", "packs", "trays", "bags", "boxes", "bunches", "tins", "jars", "rolls", "cylinders"];
