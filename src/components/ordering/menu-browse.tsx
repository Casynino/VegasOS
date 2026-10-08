"use client";

import { MenuPicker, useBasket, type OrderMenuSection } from "./menu-picker";
import { useT } from "@/i18n/client";

/** The live menu to look at only (no ordering) — e.g. a free room's QR. */
export function MenuBrowse({ sections, subtitle }: { sections: OrderMenuSection[]; subtitle: React.ReactNode }) {
  const t = useT();
  const b = useBasket(sections);
  return <MenuPicker sections={sections} basket={b.basket} setQty={b.setQty} canOrder={false} title={t("Our menu")} subtitle={subtitle} />;
}
