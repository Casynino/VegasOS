import type { RestaurantOrderType } from "@/generated/prisma/enums";
import { spotName } from "@/components/restaurant/shell";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";
import { word, type TextWord } from "@/lib/report-i18n";

/**
 * Where the waiter takes an order: the guest's room, the table, the customer's address (take out), or the counter.
 * English by default (it is also kept on the order and in its history); pass the reader's `t` to show it in their language.
 */
export function deliveryPlace(o: { type: RestaurantOrderType; roomNumber: string | null; tableLabel: string | null; deliveryAddress?: string | null }, t: T = englishT) {
  if (o.type === "ROOM_SERVICE") return o.roomNumber ? t("Room {room}", { room: o.roomNumber }) : t("Room");
  if (o.type === "DINE_IN") return o.tableLabel ? (/^\d+$/.test(o.tableLabel.trim()) ? t("Table {table}", { table: o.tableLabel.trim() }) : spotName(o.tableLabel, t)) : t("Restaurant");
  if (o.type === "TAKEAWAY" && o.deliveryAddress) return t("Take out — {address}", { address: o.deliveryAddress });
  return t("Counter");
}

/**
 * A place as the hotel named it ("Table 3 — Inside", "Counter — Outside", "Room 305") as a word for a sentence kept
 * to be said again in the reader's language (src/lib/report-i18n.ts) — the same words spotName() says; its English is
 * the name itself, unchanged.
 */
export function spotWord(name: string): TextWord {
  const part = (p: string): TextWord => {
    let m = /^Table (.+)$/.exec(p);
    if (m) return word(msg("Table {table}"), { table: m[1] });
    m = /^Room (.+)$/.exec(p);
    if (m) return word(msg("Room {room}"), { room: m[1] });
    m = /^Meeting room (.+)$/.exec(p);
    if (m) return word(msg("Meeting room {room}"), { room: m[1] });
    return word(p);
  };
  const parts = name.split(" — ");
  if (parts.length === 1) return part(name);
  return word(parts.map((_, i) => `{p${i}}`).join(" — "), Object.fromEntries(parts.map((p, i) => [`p${i}`, part(p)])));
}
