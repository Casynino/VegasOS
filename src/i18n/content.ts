import { DEFAULT_LOCALE, type Locale } from "./config";

/**
 * A name kept on a record when it was made — an order line's dish name in every language at the moment it was
 * ordered (RestaurantOrderItem.nameI18n). The English is the record's own `name`. Old orders never change when the
 * menu is renamed later.
 */
export function snapshotName(name: string, i18n: unknown, locale: Locale): string {
  if (locale === DEFAULT_LOCALE || !i18n || typeof i18n !== "object") return name;
  const v = (i18n as Record<string, unknown>)[locale];
  return typeof v === "string" && v.trim() ? v : name;
}

/** An order line's dish name for this person: its name when ordered in their language, else today's translation, else English. */
export function orderItemName(item: { name: string; nameI18n?: unknown }, t: { (key: string): string; locale: Locale }): string {
  const kept = snapshotName(item.name, item.nameI18n, t.locale);
  return kept !== item.name ? kept : t(item.name);
}
